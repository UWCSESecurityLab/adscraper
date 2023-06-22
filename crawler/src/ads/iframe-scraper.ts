import { ElementHandle, Frame } from 'puppeteer';
import {AdExternalUrls, extractExternalUrls} from './ad-external-urls.js';

/**
 * This interface contains the scraped data and metadata from an iframe. Because
 * iframes may have other iframes inside it, this interface can be a node in
 * a tree representing the nesting structure.
 */
export interface ScrapedIFrame {
  timestamp: Date,
  url: string,
  html: string,
  externals?: AdExternalUrls,
  children: Array<ScrapedIFrame>,
}

/**
 * Scrapes all iframes that are the children of the provided element.
 * @param ad The ad to scrape iframes from
 * @returns A promise containing one or more ScrapedIFrames. Each ScrapedIFrame
 * may contain sub-ScrapedIFrames.
 */
export async function scrapeIFramesInElement(ad: ElementHandle) {
  let iframes = await ad.$$('iframe');
  let scrapedIFrames: Array<ScrapedIFrame> = [];
  for (let iframe of iframes) {
    let frame = await iframe.contentFrame();
    if (frame === null) {
      continue;
    }
    // log.verbose('Scraping iframe ' + frame.url());
    const scrapedIFrame = await scrapeIframe(frame);
    scrapedIFrames.push(scrapedIFrame);
  }
  return scrapedIFrames;
}

/**
 * Scrapes an iframe and recursively scrapes any iframes within it.
 * @param iframe the Frame representing the iframe to scrape
 * @returns A promise containing the ScrapedIFrame, which will contain
 * the ScrapedIFrames of any sub-iframes.
 */
export async function scrapeIframe(iframe: Frame): Promise<ScrapedIFrame> {
  try {
    let ts = new Date();
    // WORKAROUND: await iframe.content() hangs indefinitely for some reason on
    // some ads. Evaluating this code does essentially the same thing, but doesn't
    // have that problem.
    // let thisContent = await iframe.content();
    let thisContent = await iframe.evaluate(() => {
      return document.documentElement.outerHTML;
    });

    const root = await iframe.$('html');
    // let externals;
    // if (root) {
    //   externals = await extractExternalUrls(root);
    // }

    let children: Array<ScrapedIFrame>;
    if (iframe.childFrames().length > 0) {
      children = await Promise.all(
        iframe.childFrames().map(scrapeIframe));
    } else {
      children = [];
    }
    return {
      timestamp: ts,
      url: iframe.url(),
      html: thisContent,
      children: children,
      // externals: externals
    };
  } catch (e) {
    throw e;
  }
}

