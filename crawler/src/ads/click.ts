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
 * @param adId The database id of the ad.
 * @param pageId The database id of the page (if it was scraped).
 * @returns Promise that resolves when crawling is complete for the linked page,
 * and any sub pages opened by clicking on ads in the linked page.
 */
export function clickAd(
  ad: ElementHandle,
  page: Page,
  crawlId: number,
  adId: number,
  pageId?: number) {
  return new Promise<void>(async (resolve, reject) => {
    // Reference to any new tab that is opened, that can be called in the
    // following timeout if necessary.
    let ctPage: Page | undefined;

    // Create timeout for processing overall clickthrough (including the landing page).
    // If it takes longer than this, abort handling this ad.
    const timeout = setTimeout(() => {
      ctPage?.close();
      page.removeAllListeners();
      reject(new Error(`${page.url()}: Clickthrough timed out - ${CLICKTHROUGH_TIMEOUT}ms`));
    }, CLICKTHROUGH_TIMEOUT);

    // Create timeout for the click. If the click fails to do anything,
    // abort handing this ad.
    const clickTimeout = setTimeout(() => {
      page.removeAllListeners();
      reject(new Error(`${page.url()}: Ad click timed out - ${AD_CLICK_TIMEOUT}ms`));
    }, AD_CLICK_TIMEOUT)

    // Before clicking, set up various event listeners to catch what happens
    // when the ad is clicked.

    // First, turn on request interception to enable catching popups and
    // navigations.
    await page.setRequestInterception(true);

    // Set up a Chrome DevTools session (used later for popup interception)
    const cdp = await BROWSER.target().createCDPSession();

    // Create a function to clean up everything we're about to add
    async function cleanUp() {
      await cdp.send('Target.setAutoAttach', {
        waitForDebuggerOnStart: false,
        autoAttach: false,
        flatten: true
      });
      page.removeAllListeners();
      await page.setRequestInterception(false);
    }

    // This listener handles the case where the ad tries to navigate the
    // current tab to the ad's landing page. If this happens,
    // block the navigation, and then decide what to do based on what
    // the crawl job config says.
    page.on('request', async (req) => {
      // Block navigation requests only if they are in in the top level frame
      // (iframes can also trigger this event).
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        // Stop the navigation from happening.
        req.abort('aborted');
        clearTimeout(clickTimeout);

        if (FLAGS.scrapeOptions.clickAds == 'clickAndBlockLoad') {
          // Store the request URL and continue.
          // TODO: store the URL somewhere
          console.log('Intercepted and blocked ad (navigation):', req.url());
          await cleanUp();
          resolve();
          return;
        } else if (FLAGS.scrapeOptions.clickAds == 'clickAndScrapeLandingPage') {
          // Open the blocked URL in a new tab, so that we can keep the previous
          // one open.
          log.info(`Blocked attempted navigation to ${req.url()}, opening in a new tab`);
          let newPage = await BROWSER.newPage();
          try {
            ctPage = newPage;
            await newPage.goto(req.url(), { referer: req.headers().referer });
            await scrapePage(newPage, {
              pageType: PageType.LANDING,
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
            await cleanUp();
          }
        }
      } else {
        // Allow other unrelated requests through
        req.continue();
      }
    });

    // Next, handle the case where the ad opens a popup. We have two methods
    // for handling this, depending on the desired click behavior.

    // If we want to block the popup from loading, we need to use the
    // the Chrome DevTools protocol to auto-attach to the popup when it opens,
    // and intercept the request.
    if (FLAGS.scrapeOptions.clickAds == 'clickAndBlockLoad') {
      // Enable auto-attaching the devtools debugger to new targets (i.e. popups)
      await cdp.send('Target.setAutoAttach', {
        waitForDebuggerOnStart: true,
        autoAttach: true,
        flatten: true,
        filter: [
          { type: 'page', exclude: false },
        ]
      });

      cdp.on('Target.attachedToTarget', async ({ sessionId, targetInfo }) => {
        // Get the CDP session corresponding to the popup
        let connection = cdp.connection();
        if (!connection) {
          reject(new Error('Could not get puppeteer\'s CDP connection'));
          await cleanUp();
          return;
        }
        let popupCdp = connection.session(sessionId);
        if (!popupCdp) {
          reject(new Error('Could not get CDP session of caught popup'));
          await cleanUp();
          return;
        }

        // Enable request interception in the popup
        await popupCdp.send('Fetch.enable');

        // Set up a listener to catch and block the initial navigation request
        popupCdp.on('Fetch.requestPaused', async ({ requestId, request }) => {
          // TODO: save this URL somewhere
          console.log('Intercepted and blocked ad (popup):', request.url);
          // Prevent navigation from running
          await popupCdp?.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
          // Close the tab (we don't have a puppeteer-land handle to the page)
          await popupCdp?.send('Target.closeTarget', { targetId: targetInfo.targetId });

          // Success, clean up the listeners
          await cleanUp();
          resolve();
        });

        // Allow the popup to continue executing and make the navigation request
        try {
          await popupCdp.send('Runtime.runIfWaitingForDebugger');
        } catch (e) {
          // Sometimes this fails because the request is intercepted before
          // this request is sent, and the target is already closed. However,
          // in that case we successfully got the data (somehow) so we can
          // safely do nothing here.
          log.info('Popup navigation request caught in CDP before resuming tab. Continuing...');
        }
      });

      // If we want to allow the popup to load, we can listen for the popup
      // event in puppeteer and use that page.
    } else if (FLAGS.scrapeOptions.clickAds == 'clickAndScrapeLandingPage') {
      page.on('popup', (newPage) => {
        clearTimeout(clickTimeout);

        // If the ad click opened a new tab/popup, start crawling in the new tab.
        ctPage = newPage;
        log.info(`${newPage.url()}: opened in popup`);
        injectDOMListener(newPage);
        newPage.on('load', async () => {
          try {
            await scrapePage(newPage, {
              pageType: PageType.LANDING,
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
            await cleanUp();
          }
        });
      });
    }

    // Finally click the ad
    log.info(`${page.url()}: Clicking on ad ${adId}`);

    // Attempt to use the built-in puppeteer click.
    await ad.click({ delay: 10 });
  });
}