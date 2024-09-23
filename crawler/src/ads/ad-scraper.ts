import fs from 'fs';
import path from 'path';
import { ElementHandle, Page } from 'puppeteer';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { PageType } from '../pages/page-scraper.js';
import DbClient from '../util/db.js';
import getCrawlOutputDirectory from '../util/getCrawlOutputDirectory.js';
import * as log from '../util/log.js';
import { createAsyncTimeout, sleep } from '../util/timeout.js';
import { identifyAdsInDOM } from './ad-detection.js';
import { extractExternalUrls } from './ad-external-urls.js';
import { splitChumbox } from './chumbox-handler.js';
import { clickAd } from './click.js';
import { matchDOMUpdateToAd } from './dom-monitor.js';
import { scrapeIFramesInElement } from './iframe-scraper.js';

// Handle to an ad. We store two handles: the screenshot target, which
// is the entire area of the ad, and the click target, which is the region
// that should be clicked. For example, in native ads, which consist of
// an image and a headline, the headline should usually be the click target.
export interface AdHandles {
  clickTarget: ElementHandle,
  screenshotTarget: ElementHandle | null
}

// Schema of the data scraped from each ad.
interface ScrapedAd {
  timestamp: Date,
  html: string
  screenshot?: string,
  screenshot_host?: string,
  winning_bid?: boolean,
  max_bid_price?: number
  with_context: boolean,
  bb_x?: number,
  bb_y?: number,
  bb_height?: number,
  bb_width?: number
}

/**
 * Crawler metadata to be stored with scraped ad data.
 * @property crawlId: id of the current crawl list entry
 * @property pageType: Type of the parent page
 * @property parentPageId: The database id of the page the ad appears on
 * @property chumboxId: The chumbox the ad belongs to, if applicable
 * @property platform: The ad platform used by this ad, if identified
 */
interface CrawlAdMetadata {
  crawlListIndex: number,
  pageType: PageType,
  parentPageId: number,
  originalUrl: string,
  chumboxId?: number,
  platform?: string
}

export async function scrapeAdsOnPage(page: Page, metadata: CrawlAdMetadata) {
  const db = DbClient.getInstance();

  // Detect ads
  const ads = await identifyAdsInDOM(page);
  const adHandleToAdId = new Map<ElementHandle, number>();
  log.info(`${page.url()}: ${ads.size} ads identified`);

  let i = 1;
  // Main loop through all ads on page
  for (let ad of ads) {
    log.info(`${page.url()}: Scraping ad ${i} of ${ads.size}`)

    // An ad can contain multiple sub-ads (a "chumbox"). We store the handles
    // in case this happens.
    let adHandles: AdHandles[];
    let chumboxId: number | undefined;
    let platform: string | undefined;

    // Check and see if the ad is a chumbox.
    let chumbox = await splitChumbox(ad);
    if (chumbox) {
      // If it is a chumbox, create the metadata in the database...
      chumboxId = await db.insert({
        table: 'chumbox',
        returning: 'id',
        data: { platform: chumbox.platform, parent_page: metadata.parentPageId }
      });
      platform = chumbox.platform;
      // And use the array of ad handles for the next part.
      adHandles = chumbox.adHandles;
    } else {
      // Otherwise, the array is just the one ad.
      adHandles = [{ clickTarget: ad, screenshotTarget: ad }];
    }

    for (let adHandle of adHandles) {
      let adId = -1;
      try {
        // Scrape the ad
        const scrapeTarget = adHandle.screenshotTarget
          ? adHandle.screenshotTarget
          : adHandle.clickTarget;
        adId = await scrapeAd(scrapeTarget, page, {
          crawlListIndex: metadata.crawlListIndex,
          pageType: metadata.pageType,
          parentPageId: metadata.parentPageId,
          originalUrl: metadata.originalUrl,
          chumboxId: chumboxId,
          platform: platform
        });
        adHandleToAdId.set(ad, adId);
      } catch (e) {
        log.warning('Couldn\'t scrape ad: ' + e);
        i += 1;
        continue;
      }

      try {
        if (FLAGS.scrapeOptions.clickAds !== 'noClick') {
          // Abort if the ad is non-existent or too small
          const bounds = await adHandle.clickTarget.boundingBox();
          if (!bounds) {
            log.warning(`Aborting click on ad ${adId}: no bounding box`);
            continue;
          }
          if (bounds.height < 30 || bounds.width < 30) {
            log.warning(`Aborting click on ad ${adId}: bounding box too small (${bounds.height},${bounds.width})`);
            continue;
          }

          // Ok, we're cleared to click.
          await clickAd(
            adHandle.clickTarget,
            page,
            adId,
            metadata.parentPageId,
            metadata.crawlListIndex,
            metadata.originalUrl
          );
        }
      } catch (e) {
        log.warning('Couldn\'t click ad: ' + e);
      }
      i += 1;
    }
  }
  // const mutations = await matchDOMUpdateToAd(page, adHandleToAdId);
  // if (mutations.length > 0) {
  //   for (let mutation of mutations) {
  //     await db.insert({
  //       table: 'ad_domain',
  //       data: mutation
  //     });
  //   }
  // }
}

/**
 * Scrapes the content and takes a screenshot of an ad embedded in a page,
 * including all sub-frames, and then saves it in the adscraper database.
 * @param ad A handle to the HTML element bounding the ad.
 * @param page The page the ad appears on.
 * @param metadata Crawler metadata linked to this ad.
 * @returns Promise containing the database id of the scraped ad, once it is
 * done crawling/saving.
 */
export async function scrapeAd(ad: ElementHandle,
  page: Page,
  metadata: CrawlAdMetadata): Promise<number> {

  const db = DbClient.getInstance();

  let [timeout, timeoutId] = createAsyncTimeout<number>(
    `${page.url()}: timed out while scraping ad`, AD_SCRAPE_TIMEOUT);

  // Declare adId here - we create an empty row in the database before
  // the ad is scraped, so we can use the id for the directory name.
  // If the process fails at an point, we have the adId in
  // scope so we can delete it.
  let adId: number | undefined;

  const _crawlAd = (async () => {
    try {
      // Create an ad id for the directory
      adId = await db.createEmptyAd();

      // Scroll ad into view, and sleep to give it time to load.
      await page.evaluate((e: Element) => {
        e.scrollIntoView({ block: 'center' });
      }, ad);
      await sleep(AD_SLEEP_TIME);

      const adsDir = path.join(
        await getCrawlOutputDirectory(),
        'scraped_ads/ad_' + adId);

      const fullAdsDir = path.join(FLAGS.outputDir, adsDir);
      if (!fs.existsSync(fullAdsDir)) {
        fs.mkdirSync(fullAdsDir, { recursive: true });
      }

      // Scrape ad content
      const adContent = await scrapeAdContent(
        page, ad, fullAdsDir,
        FLAGS.scrapeOptions.screenshotAdsWithContext,
        adId);

      await db.updateAd(adId, {
        job_id: FLAGS.jobId,
        crawl_id: CRAWL_ID,
        parent_page: metadata.parentPageId,
        parent_page_url: page.url(),
        parent_page_type: metadata.pageType,
        chumbox_id: metadata.chumboxId,
        platform: metadata.platform,
        ...adContent
      });

      log.debug(`${page.url()}: Archived ad content with id ${adId}`);

      // Extract 3rd party domains from ad
      // const adExternals = await extractExternalUrls(ad);
      // await db.archiveExternalUrls(adExternals, adId);

      // Scrape iframe content in ad
      const scrapedIFrames = await scrapeIFramesInElement(ad);
      for (let scrapedIFrame of scrapedIFrames) {
        await db.archiveScrapedIFrame(scrapedIFrame, adId, undefined);
      }
      clearTimeout(timeoutId);
      return adId;
    } catch (e) {
      clearTimeout(timeoutId);
      if (adId) {
        db.postgres.query('DELETE FROM ad WHERE id=$1', [adId]);
      }
      throw e;
    }
  })();
  try {
    const res = await Promise.race([timeout, _crawlAd])
    return res;
  } catch (e) {
    if (adId) {
      db.postgres.query('DELETE FROM ad WHERE id=$1', [adId]);
      const dir = path.join(
        FLAGS.outputDir,
        await getCrawlOutputDirectory(),
        'scraped_ads/ad_' + adId);
      if (fs.readdirSync(dir).length == 0) {
        fs.rmdirSync(dir);
      }
    }

    throw e;
  }
}

/**
 * Collects the content of the ad.
 * - Takes a screenshot
 * - Saves the HTML content of the ad
 * - Collects bid values from prebid.js, if available
 * @param page The page the element appears on
 * @param ad The ad/element to scroll to/scrape
 * @param screenshotDir Where the screenshot should be saved
 * @param screenshotHost The hostname of the machine on which the screenshot
 * will be stored.
 * @param adId The id that references this ad in the database. Optional,
 * uses a UUID otherwise.
 * @returns A promise containing id of the stored ad in the database.
*/
async function scrapeAdContent(
  page: Page,
  ad: ElementHandle,
  screenshotDir: string,
  withContext: boolean,
  adId?: number): Promise<ScrapedAd> {

  // Collect the HTML content
  const html = await page.evaluate((e: Element) => e.outerHTML, ad);

  const screenshotFile = (adId ? 'ad_' + adId : uuidv4()) + '.webp';
  const savePath = path.join(screenshotDir, screenshotFile);
  let screenshotFailed = false;
  let adInContextBB: sharp.Region | undefined;
  await page.evaluate((e: Element) => {
    e.scrollIntoView({ block: 'center' });
  }, ad);

  const abb = await ad.boundingBox();
  if (!abb) {
    throw new Error('No ad bounding box');
  }
  if (abb.height < 30 || abb.width < 30) {
    throw new Error('Ad smaller than 30px in one dimension');
  }

  const viewport = page.viewport();
  if (!viewport) {
    throw new Error('Page has no viewport');
  }

  // Round the bounding box values in case they are non-integers
  let adBB = {
    left: Math.max(0, Math.floor(abb.x)),
    top: Math.max(0, Math.floor(abb.y)),
    height: Math.ceil(abb.height),
    width: Math.ceil(abb.width)
  }

  // Compute bounding box if a margin is desired
  const margin = 150;
  const contextLeft = Math.max(adBB.left - margin, 0);
  const contextTop = Math.max(adBB.top - margin, 0);
  const marginTop = adBB.top - contextTop;
  const marginLeft = adBB.left - contextLeft;
  const marginBottom = adBB.top + adBB.height + margin < viewport.height
    ? margin
    : viewport.height - adBB.height - adBB.top;
  const marginRight = adBB.left + adBB.width + margin < viewport.width
    ? margin
    : viewport.width - adBB.width - adBB.left;
  const contextWidth = adBB.width + marginLeft + marginRight;
  const contextHeight = adBB.height + marginTop + marginBottom;

  const contextBB = {
    left: contextLeft,
    top: contextTop,
    height: contextHeight,
    width: contextWidth
  };
  // Recompute ad bounding box within the crop with context
  if (withContext) {
    adInContextBB = {
      left: adBB.left - contextBB.left,
      top: adBB.top - contextBB.top,
      height: adBB.height,
      width: adBB.width
    };
  }

  const buf = await page.screenshot();

  // Crop to element size (puppeteer's built in implementation caused many
  // blank screenshots in the past)
  await sharp(buf)
    .extract(withContext ? contextBB : adBB)
    .webp({ lossless: true })
    .toFile(savePath);

  const prebid = await getPrebidBidsForAd(ad);

  return {
    timestamp: new Date(),
    // Save path to screenshot in database as relative path
    screenshot: screenshotFailed ? undefined : savePath.replace(`${FLAGS.outputDir}/`, ''),
    html: html,
    max_bid_price: prebid?.max_bid_price,
    winning_bid: prebid?.winning_bid,
    with_context: withContext,
    bb_x: adInContextBB?.left,
    bb_y: adInContextBB?.top,
    bb_height: adInContextBB?.height,
    bb_width: adInContextBB?.width
  };
}

/**
 * Attempts to extract the bid price for this ad from the prebid.js library,
 * if available on the page.
 * @param ad The ad to get bid values from.
 */
function getPrebidBidsForAd(ad: ElementHandle) {
  try {
    return ad.evaluate((ad: Element) => {
      // Check if the page has prebid
      // @ts-ignore
      if (typeof pbjs === 'undefined' || pbjs.getAllWinningBids === undefined) {
        return { max_bid_price: undefined, winning_bid: undefined };
      }

      function isChildOfAd(element: HTMLElement | null) {
        if (!element) {
          return false;
        }
        if (element === ad) {
          return true;
        }
        let current = element;
        while (current !== document.body && current.parentNode !== null) {
          current = current.parentNode as HTMLElement;
          if (element === ad) {
            return true;
          }
        }
        return false;
      }

      // Check if any winning bids match the ad element (or its children).
      // @ts-ignore
      const winningBids = pbjs.getAllWinningBids();
      const matchingWins = winningBids.filter((win: any) => {
        return isChildOfAd(document.getElementById(win.adUnitCode));
      });
      if (matchingWins.length !== 0) {
        const matchingWin = matchingWins[0];
        return { max_bid_price: matchingWin.cpm, winning_bid: true };
      }

      // Check if any other bids match the children
      // @ts-ignore
      const bidResponses = pbjs.getBidResponses();
      const matches = Object.keys(bidResponses).filter(key => {
        return isChildOfAd(document.getElementById(key));
      });
      if (matches.length === 0) {
        return { max_bid_price: undefined, winning_bid: undefined };
      }
      const match = matches[0];

      if (!bidResponses[match].bids) {
        return { max_bid_price: undefined, winning_bid: undefined };
      }

      return {
        max_bid_price: Math.max(...bidResponses[match].bids.map((b: any) => b.cpm)),
        winning_bid: false
      }
    });
  } catch (e: any) {
    log.warning('Error in Prebid data collection: ' + e.message);
  }
}

