import path from 'path';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import * as log from './log.js';

export interface AdHandles {
  clickTarget: puppeteer.ElementHandle,
  screenshotTarget: puppeteer.ElementHandle | null
}

interface ScrapedAd {
  timestamp: Date,
  html: string
  screenshot?: string,
  screenshot_host?: string,
  selectors?: string,
  winning_bid?: boolean,
  max_bid_price?: number
  with_context: boolean,
  bb_x?: number,
  bb_y?: number,
  bb_height?: number,
  bb_width?: number
}

/**
 * Scrapes the content of an ad, including HTML and screenshot data.
 * This function will automatically scroll to the ad in question, and wait
 * fo
 * @param page The page the element appears on
 * @param ad The ad/element to scroll to/scrape
 * @param screenshotDir Where the screenshot should be saved
 * @param externalScreenshotDir If the crawler is in a Docker container,
 * the directory where the screenshot actually lives, in the Docker host.
 * @param screenshotHost The hostname of the machine on which the screenshot
 * will be stored.
 * @returns A promise containing the outerHTML of the element, which resolves
 * after waiting a few seconds.
*/
export async function scrape(
  page: puppeteer.Page,
  ad: puppeteer.ElementHandle,
  screenshotDir: string,
  externalScreenshotDir: string | undefined,
  screenshotHost: string,
  withContext: boolean): Promise<ScrapedAd> {

  // Collect the HTML content
  const html = await page.evaluate((e: Element) => e.outerHTML, ad);

  const screenshotFile = uuidv4() + '.webp';
  const savePath = path.join(screenshotDir, screenshotFile);
  const realPath = externalScreenshotDir
    ? path.join(externalScreenshotDir, screenshotFile)
    : undefined;
  let screenshotFailed = false;
  let adInContextBB: sharp.Region | undefined;
  try {

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
      left: Math.floor(abb.x),
      top: Math.floor(abb.y),
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

  } catch (e: any) {
    screenshotFailed = true;
    log.warning('Couldn\'t capture screenshot');
    log.warning(e.message);
  }

  const prebid = await getPrebidBidsForAd(ad);

  return {
    timestamp: new Date(),
    screenshot: screenshotFailed ? undefined : (realPath ? realPath : savePath),
    screenshot_host: screenshotFailed ? undefined : screenshotHost,
    html: html,
    max_bid_price: prebid.max_bid_price,
    winning_bid: prebid.winning_bid,
    with_context: withContext,
    bb_x: adInContextBB?.left,
    bb_y: adInContextBB?.top,
    bb_height: adInContextBB?.height,
    bb_width: adInContextBB?.width
  }
}

function toRegion(bb: puppeteer.BoundingBox): sharp.Region {
  return {
    left: bb.x,
    top: bb.y,
    height: bb.height,
    width: bb.width
  };
}

/**
 * Attempts to extract the bid price for this ad from the prebid.js library,
 * if available on the page.
 * @param ad The ad to get bid values from.
 */
function getPrebidBidsForAd(ad: puppeteer.ElementHandle) {
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

    return {
      max_bid_price: Math.max(...bidResponses[match].bids.map((b: any) => b.cpm)),
      winning_bid: false
    }
  });
}
