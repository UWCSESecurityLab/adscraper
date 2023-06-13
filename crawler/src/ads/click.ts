import { ElementHandle, Page } from "puppeteer";
import * as log from '../util/log.js';
import { injectDOMListener } from "./dom-monitor.js";
import { PageType, scrapePage } from "../pages/page-scraper.js";

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
export function clickAd(
  ad: ElementHandle,
  page: Page,
  parentDepth: number,
  crawlId: number,
  pageId: number,
  adId: number) {
  // log.info(`${page.url()}: Clicking ad`)
  return new Promise<void>((resolve, reject) => {
    let ctPage: Page | undefined;

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
        let newPage = await BROWSER.newPage();
        try {
          ctPage = newPage;
          if (!FLAGS.warmingCrawl) {
            await injectDOMListener(newPage)
          }
          await newPage.goto(req.url(), { referer: req.headers().referer });
          log.info(`${newPage.url()}: manually opened in new tab`);
          await scrapePage(newPage, {
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
      // If the ad click opened a new tab/popup, start crawling in the new tab.
      ctPage = newPage;
      log.info(`${newPage.url()}: opened in popup`);
      if (!FLAGS.warmingCrawl) {
        injectDOMListener(newPage);
      }
      clearTimeout(adClickTimeout);
      newPage.on('load', async () => {
        try {
          await scrapePage(newPage, {
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
    (async function () {
      if (FLAGS.clearCookiesBeforeCT) {
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