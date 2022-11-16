import fs from 'fs';
import { Client } from 'pg';
import puppeteer from "puppeteer";
import {addExtra} from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import sourceMapSupport from 'source-map-support';
import * as adDetection from './ad-detection.js';
import * as adScraper from './ad-scraper.js';
import { splitChumbox } from './chumbox-scraper.js';
import DbClient from './db.js';
import { extractExternalDomains } from './domain-extractor.js';
import { findArticle, findPageWithAds } from './find-page.js';
import * as iframeScraper from './iframe-scraper.js';
import * as log from './log.js';
import * as pageScraper from './page-scraper.js';
import { PageType } from './page-scraper.js';
import * as trackingEvasion from './tracking-evasion.js';
import * as domMonitor from './dom-monitor.js';
import publicIp from 'public-ip';
import {Entry} from "buttercup";
import {login} from "./google_login.js";
import Timeout = NodeJS.Timeout;
import {scrollRandomly} from "./util.js";

sourceMapSupport.install();

export interface CrawlerFlags {
  clearCookiesBeforeCT: boolean,
  crawlArticle: boolean,
  crawlerHostname: string,
  crawlPageWithAds: boolean,
  dataset: string,
  disableAllCookies: boolean,
  disableThirdPartyCookies: boolean,
  jobId: number,
  label?: string,
  maxPageCrawlDepth: number,
  screenshotAdsWithContext: boolean
  screenshotDir: string,
  externalScreenshotDir?: string,
  skipCrawlingSeedUrl: boolean,
  url: string,
  warmingCrawl: boolean,
  updateCrawlerIpField: boolean
};

let flags: CrawlerFlags;
let OVERALL_TIMEOUT: number;
let CLICKTHROUGH_TIMEOUT: number;
let AD_CLICK_TIMEOUT: number;
let PAGE_CRAWL_TIMEOUT: number;
let AD_CRAWL_TIMEOUT: number;
let AD_SLEEP_TIME: number;
let PAGE_SLEEP_TIME: number;
const VIEWPORT = { width: 1366, height: 768 };
let db: DbClient;
let browser: puppeteer.Browser;

function setupGlobals(crawlerFlags: CrawlerFlags) {
  flags = crawlerFlags;
  // How long the crawler should spend on the whole crawl (all pages/ads/CTs)
  OVERALL_TIMEOUT = flags.warmingCrawl ? 10 * 60 * 1000 : 25 * 60 * 1000;
  // How long the crawler can spend on each clickthrough page
  CLICKTHROUGH_TIMEOUT = flags.warmingCrawl ? 5 * 1000 : 30 * 1000;
  // How long the crawler should wait after clicking before trying an alternative
  // click method.
  AD_CLICK_TIMEOUT = 5 * 1000;
  // How long the crawler can spend waiting for the HTML of a page.
  PAGE_CRAWL_TIMEOUT = 60 * 1000;
  // How long the crawler can spend waiting for the HTML and screenshot of an ad.
  // must be greater than |AD_SLEEP_TIME|
  AD_CRAWL_TIMEOUT = 20 * 1000;
  // How long the crawler should sleep before scraping/screenshotting an ad
  AD_SLEEP_TIME = flags.warmingCrawl ? 0 : 5 * 1000;
  // How long the crawler should sleep before çrawling a page
  PAGE_SLEEP_TIME = flags.warmingCrawl ? 0 : 10 * 1000;
}

function createAsyncTimeout<T>(message: string, ms: number): [Promise<T>, NodeJS.Timeout] {
  let timeoutId: Timeout;
  const timeout = new Promise<void>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${message} - ${ms}ms`));
    }, ms)
  });
  // @ts-ignore
  return [timeout, timeoutId];
}

/**
 * Crawler metadata to be stored with scraped ad data.
 * @property parentPageId: The database id of the page the ad appears on
 * @property parentDepth: The depth of the parent page
 * @property chumboxId: The chumbox the ad belongs to, if applicable
 * @property platform: The ad platform used by this ad, if identified
 */
interface CrawlAdMetadata {
  parentPageId: number,
  parentDepth: number,
  chumboxId?: number,
  platform?: string
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
async function crawlAd(ad: puppeteer.ElementHandle,
                       page: puppeteer.Page,
                       metadata: CrawlAdMetadata): Promise<number> {
  let [timeout, timeoutId] = createAsyncTimeout<number>(
    `${page.url()}: timed out while crawling ad`, AD_CRAWL_TIMEOUT);
  const _crawlAd = (async () => {
    try {
      // Scroll ad into view, and sleep to give it time to load.
      // But only sleep if crawling ads from the seed page, skip sleep on
      // landing pages
      const sleepDuration = metadata.parentDepth > 1 ? 0 : AD_SLEEP_TIME;
      await page.evaluate((e: Element) => {
        e.scrollIntoView({ block: 'center' });
      }, ad);
      await page.waitForTimeout(sleepDuration);

      // Scrape ad content
      const adContent = await adScraper.scrape(
        page,
        ad,
        flags.screenshotDir,
        flags.externalScreenshotDir,
        flags.crawlerHostname,
        flags.screenshotAdsWithContext);

      const adId = await db.archiveAd({
        job_id: flags.jobId,
        parent_page: metadata.parentPageId,
        chumbox_id: metadata.chumboxId,
        platform: metadata.platform,
        depth: metadata.parentDepth + 1,
        ...adContent
      });

      // Extract 3rd party domains from ad
      const adExternals = await extractExternalDomains(ad);
      await db.archiveExternalDomains(adExternals, adId);

      // Scrape iframe content in ad
      const scrapedIFrames = await iframeScraper.scrapeIFramesInElement(ad);
      for (let scrapedIFrame of scrapedIFrames) {
        await db.archiveScrapedIFrame(scrapedIFrame, adId, undefined);
      }
      clearTimeout(timeoutId);
      return adId;
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  })();
  return Promise.race([timeout, _crawlAd])
}

/**
 * @property pageType: Type of page (e.g. home page, article)
 * @property currentDepth: The depth of the crawl at the current page.
 * @property crawlId: The database id of this crawl job.
 * @property referrerPage: If this is a clickthrough page, the id of the page
 * page that linked to this page.
 * @property referrerAd: If this is a clickthrough page, the id of the ad
 * that linked to this page.
 */
interface CrawlPageMetadata {
  pageType: pageScraper.PageType,
  currentDepth: number,
  crawlId: number,
  referrerPage?: number,
  referrerAd?: number
}
/**
 * Crawls a page and all of the ads appearing on it, and saves the content in
 * the database. If the maximum crawl depth has not been reached, any ads on the
 * page will be clicked and crawled too.
 * @param page The page to be crawled.
 * @param metadata Crawler metadata linked to this page.
 * @returns Promise that resolves when the page is crawled.
 */
async function crawlPage(page: puppeteer.Page, metadata: CrawlPageMetadata): Promise<void> {
  log.info(`${page.url()}: Scraping page`);
  await page.waitForTimeout(PAGE_SLEEP_TIME);
  let [timeout, timeoutId] = createAsyncTimeout<void>(
    `${page.url()}: Timed out crawling page`, PAGE_CRAWL_TIMEOUT);

  const _crawlPage = await (async () => {
    try {
      let pageId = -1;
      if (!flags.warmingCrawl) {
        const scrapedPage = await pageScraper.scrape(
            page,
            flags.screenshotDir,
            flags.externalScreenshotDir,
            flags.crawlerHostname);
        //@ts-ignore
        pageId = await db.archivePage({
          crawl_id: metadata.crawlId,
          job_id: flags.jobId,
          page_type: metadata.pageType,
          depth: metadata.currentDepth,
          referrer_page: metadata.referrerPage,
          referrer_ad: metadata.referrerAd,
          ...scrapedPage
        });
        log.info(`${page.url()}: Archived page content`);
      }

      clearTimeout(timeoutId);
      if (flags.warmingCrawl) {
        return;
      }

      console.log("Beginning scroll");
      for (let counter: number = 0; counter < 60; counter++) {
        await scrollRandomly(page);
      }

      const ads = await adDetection.identifyAdsInDOM(page);
      log.info(`${page.url()}: ${ads.size} ads identified`);

      const adHandleToAdId = new Map<puppeteer.ElementHandle, number>();
      for (let ad of ads) {
        // Check if the ad contain a chumbox
        let adHandles: adScraper.AdHandles[];
        let platform: string | undefined = undefined;
        let chumboxId: number | undefined = undefined;
        let chumboxes = Object.entries(await splitChumbox(ad))
            .filter(([, handles]) => handles !== null);
        if (chumboxes.length === 1 && chumboxes[0][1] !== null) {
          platform = chumboxes[0][0];
          adHandles = chumboxes[0][1];
          chumboxId = await db.insert({
            table: 'chumbox',
            returning: 'id',
            data: {platform: platform, parent_page: pageId}
          });
        } else {
          adHandles = [{clickTarget: ad, screenshotTarget: ad}];
        }
        // Crawl and click on the ad(s)
        for (let adHandle of adHandles) {
          try {
            let adId = -1;
            const crawlTarget = adHandle.screenshotTarget
                ? adHandle.screenshotTarget
                : adHandle.clickTarget;
            adId = await crawlAd(crawlTarget, page, {
              parentPageId: pageId,
              parentDepth: metadata.currentDepth,
              chumboxId: chumboxId,
              platform: platform
            });
            log.info(`${flags.url}: Ad archived, saved under id=${adId}`);
            adHandleToAdId.set(ad, adId);

            if (metadata.currentDepth + 2 >= 2 * flags.maxPageCrawlDepth) {
              log.info(`Reached max depth: ${metadata.currentDepth}`);
              continue;
            }
            const bounds = await adHandle.clickTarget.boundingBox();
            if (!bounds) {
              log.warning(`Ad ${adId}: no bounding box`);
              continue;
            }
            if (bounds.height < 10 || bounds.width < 10) {
              log.warning(`Ad ${adId}: bounding box too small (${bounds.height},${bounds.width})`);
              continue;
            }
            // TODO: Do not click on ad - otherwise our profile will be affected
            // await clickAd(adHandle.clickTarget, page, metadata.currentDepth, metadata.crawlId, pageId, adId);
          } catch (e) {
            log.error(e);
          }
        }
      }
      if (!flags.warmingCrawl) {
        const mutations = await domMonitor.matchDOMUpdateToAd(page, adHandleToAdId);
        if (mutations.length > 0) {
          for (let mutation of mutations) {
            await db.insert({
              table: 'ad_domain',
              data: mutation
            });
          }
        }
      }
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  })();
  return Promise.race([timeout, _crawlPage]);
}

/**
 * Clicks on an ad, and starts a crawl on the page that it links to.
 * @param ad A handle to the ad to click on.
 * @param page The page the ad appears on.
 * @param parentDepth The depth of the parent page of the ad.
 * @param crawlId The database id of this crawl job.
 * @param pageId The database id of the page.
 * @param adId The database id of the ad.
 * @returns Promise that resolves when crawling is complete for the linked page,
 * and any sub pages opened by clicking on ads in the linked page.
 */
function clickAd(
    ad: puppeteer.ElementHandle,
    page: puppeteer.Page,
    parentDepth: number,
    crawlId: number,
    pageId: number,
    adId: number) {
  // log.info(`${page.url()}: Clicking ad`)
  return new Promise<void>((resolve, reject) => {
    let ctPage: puppeteer.Page | undefined;

    // Create timeout for processing overall clickthrough. If it takes longer
    // than this, abort handling this ad.
    const timeout = setTimeout(() => {
      if (ctPage) {
        ctPage.close();
      }
      reject(new Error(`${page.url()}: Clickthrough timed out - ${CLICKTHROUGH_TIMEOUT}ms`));
      page.removeAllListeners();
    }, CLICKTHROUGH_TIMEOUT);

    // Wait for the puppeteer click, and if the puppeteer click failed for some
    // reason, manually click in the middle of the ad's bounding box.
    const adClickTimeout = setTimeout(async () => {
      const bounds = await ad.boundingBox();
      log.info(`${page.url()}: Puppeteer click failed on ad ${adId}, attempting manual click in middle of ad`);
      if (!bounds) {
        reject(new Error(`${page.url()}: Ad ${adId} does not have a valid bounding box`));
        page.removeAllListeners();
        return;
      }
      log.info(`${page.url()}: Ad ${adId} has size ${bounds.width}x${bounds.height},
          positioned at ${bounds.x},${bounds.y}.
          Manually clicking at ${bounds.x + bounds.width / 2},${bounds.y + bounds.height / 2}.`);
      await page.mouse.click(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
        { delay: 10 }
      );
    }, AD_CLICK_TIMEOUT);

    // First, set up event handlers to catch the page created when the ad is
    // clicked.
    page.on('request', async (req) => {
      // If the click tries to navigate the page instead of opening it in a
      // new tab, block it and manually open it in a new tab.
      if (req.isNavigationRequest() && req.frame() === page.mainFrame() && req.url() !== page.url()) {
        log.info(`Blocked attempted navigation to ${req.url()}, opening manually`);
        req.abort('aborted');
        clearTimeout(adClickTimeout);
        let newPage = await browser.newPage();
        await trackingEvasion.evadeHeadlessChromeDetection(newPage);
        try {
          ctPage = newPage;
          if (!flags.warmingCrawl) {
            await domMonitor.injectDOMListener(newPage)
          }
          await newPage.goto(req.url(), {referer: req.headers().referer});
          log.info(`${newPage.url()}: manually opened in new tab`);
          await crawlPage(newPage, {
            pageType: PageType.LANDING,
            currentDepth: parentDepth + 2,
            crawlId: crawlId,
            referrerPage: pageId,
            referrerAd: adId
          });
          clearTimeout(timeout);
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          await newPage.close();
          page.removeAllListeners();
        }
      } else {
        // Allow other unrelated requests through
        req.continue();
      }
    });

    page.on('popup', (newPage) => {
      trackingEvasion.evadeHeadlessChromeDetection(newPage);
      // If the ad click opened a new tab/popup, start crawling in the new tab.
      ctPage = newPage;
      log.info(`${newPage.url()}: opened in popup`);
      if (!flags.warmingCrawl) {
        domMonitor.injectDOMListener(newPage);
      }
      clearTimeout(adClickTimeout);
      newPage.on('load', async () => {
        try {
          await crawlPage(newPage, {
            pageType: PageType.LANDING,
            currentDepth: parentDepth + 2,
            crawlId: crawlId,
            referrerPage: pageId,
            referrerAd: adId
          });
          clearTimeout(timeout);
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          await newPage.close();
          page.removeAllListeners();
        }
      });
    });

    // Take care of a few things before clicking on the ad:
    (async function() {
      if (flags.clearCookiesBeforeCT) {
        // Clear all cookies to minimize tracking from prior clickthroughs.
        const cdp = await page.target().createCDPSession();
        await cdp.send('Network.clearBrowserCookies')
      }
      // Intercept requests to catch popups and navigations.
      await page.setRequestInterception(true)
      // Finally click the ad
      log.info(`${page.url()}: Clicking on ad ${adId}`);

      // Attempt to use the built-in puppeteer click.
      await ad.click({ delay: 10 });
    })();
  });
}

export async function crawl(flags: CrawlerFlags, postgres: Client, profile: Entry) {
  if (!fs.existsSync(flags.screenshotDir)) {
    console.log(`${flags.screenshotDir} is not a valid directory`);
    process.exit(1);
  }

  if (flags.updateCrawlerIpField) {
    await setCrawlerIpField(flags.jobId, postgres);
  }

  setupGlobals(flags);
  console.log(flags);
  db = new DbClient(postgres);

  // Open browser
  log.info('Launching browser...');
  const extraPuppeteer = addExtra(puppeteer);
  extraPuppeteer.use(StealthPlugin());
  const launchOptions = {
    args: ['--disable-dev-shm-usage'],
    defaultViewport: VIEWPORT,
    headless: false,
  };
  //@ts-ignore
  browser = await extraPuppeteer.launch(launchOptions);

  // Login into google
  await login(browser, profile);

  const version = await browser.version();

  log.info('Running ' + version);

  // Set up tracking/targeting evasion
  await trackingEvasion.spoofUserAgent(browser);
  await trackingEvasion.disableCookies(
    browser, flags.disableAllCookies, flags.disableThirdPartyCookies);

  // Insert record for this crawl
  try {
    let crawlId: number;
    if (!flags.skipCrawlingSeedUrl) {
      crawlId = await db.insert({
        table: 'crawl',
        returning: 'id',
        data: {
          timestamp: new Date(),
          job_id: flags.jobId,
          dataset: flags.dataset,
          label: flags.label,
          seed_url: flags.url,
          warming_crawl: flags.warmingCrawl
        }
      }) as number;
    } else {
      let crawlQuery = await postgres.query(`SELECT id FROM crawl WHERE job_id=$1 AND seed_url=$2 AND warming_crawl='f'`,
        [flags.jobId, flags.url]);
      crawlId = crawlQuery.rows[0].id as number;
    }

    // Open the seed page
    log.info(`${flags.url}: loading page`);
    let seedPage = (await browser.pages())[0];
    if (!flags.skipCrawlingSeedUrl && !flags.warmingCrawl) {
      await domMonitor.injectDOMListener(seedPage);
    }

    await trackingEvasion.evadeHeadlessChromeDetection(seedPage);

    await seedPage.goto(flags.url, { timeout: 60000 });

    // Set up timeout to kill the crawler if it stalls
    setTimeout(async () => {
      log.strError(`Crawler instance timed out: ${OVERALL_TIMEOUT}ms`)
      await browser.close();
      process.exit(1);
    }, OVERALL_TIMEOUT);

    // Crawl the page
    if (!flags.skipCrawlingSeedUrl) {
      await crawlPage(seedPage, {
        pageType: PageType.HOME,
        currentDepth: 1,
        crawlId: crawlId
      });
    }

    if (!flags.warmingCrawl && flags.crawlArticle) {
      // Find and crawl an article on the page
      log.info(`${flags.url}: Searching for article`);
      const article = await findArticle(seedPage);
      if (article) {
        log.info(`${flags.url}: Successfully fetched article ${article}`);
        log.info(`${article}: loading page`);
        const articlePage = await browser.newPage();
        await trackingEvasion.evadeHeadlessChromeDetection(articlePage);
        await domMonitor.injectDOMListener(articlePage);
        await articlePage.goto(article, { timeout: 60000 });
        await crawlPage(articlePage, {
          pageType: PageType.ARTICLE,
          currentDepth: 1,
          crawlId: crawlId
        });
        await articlePage.close();
      } else {
        log.strError(`${flags.url}: Couldn't find article`);
      }
    } else if (!flags.warmingCrawl && flags.crawlPageWithAds) {
      log.info(`${flags.url}: Searching for page with ads`);
      const article = await findPageWithAds(seedPage);
      if (article) {
        log.info(`${flags.url}: Successfully found page with ads ${article}`);
        log.info(`${article}: loading page`);
        const adsPage = await browser.newPage();
        await trackingEvasion.evadeHeadlessChromeDetection(adsPage);
        await domMonitor.injectDOMListener(adsPage);
        await adsPage.goto(article, { timeout: 60000 });
        await crawlPage(adsPage, {
          pageType: PageType.SUBPAGE,
          currentDepth: 1,
          crawlId: crawlId
        });
        await adsPage.close();
      } else {
        log.strError(`${flags.url}: Couldn't find article`);
      }
    }

    await seedPage.close();
    await browser.close();
    log.info('Crawl job completed');
  } catch (e) {
    log.error(e);
    await browser.close();
    throw e;
  }
}

async function setCrawlerIpField(jobId: number, postgres: Client) {
  try {
    const ip = await getPublicIp();
    if (!ip) {
      console.log('Couldn\'t find public IP address');
      return;
    }
    console.log(ip)
    await postgres.query('UPDATE job SET crawler_ip=$1 WHERE id=$2;', [ip, jobId]);
    console.log('updated ip');
  } catch (e) {
    console.log(e);
  }
}

async function getPublicIp() {
  try {
    let v4 = await publicIp.v4();
    if (v4) {
      return v4;
    }
  } catch (e) {
    console.log(e);
    try {
      let v6 = await publicIp.v6();
      if (v6) {
        return v6;
      }
    } catch (e) {
      console.log(e);
      return null;
    }
  }
}
