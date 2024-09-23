import { ElementHandle, HTTPRequest, Page } from "puppeteer";
import * as log from '../util/log.js';
import { injectDOMListener } from "./dom-monitor.js";
import { PageType, scrapePage } from "../pages/page-scraper.js";
import DbClient from "../util/db.js";
import { sleep } from "../util/timeout.js";

/**
 * Clicks on an ad, and starts a crawl on the page that it links to.
 * @param ad A handle to the ad to click on.
 * @param page The page the ad appears on.
 * @param adId The database id of the ad.
 * @param pageId The database id of the page the ad appeared on.
 * @param crawlListIndex The index of the page in the crawl list.
 * @param originalUrl The URL of the page the ad appeared on.
 * @returns Promise that resolves when crawling is complete for the linked page,
 * and any sub pages opened by clicking on ads in the linked page.
 */
export function clickAd(
  ad: ElementHandle,
  page: Page,
  adId: number,
  pageId: number,
  crawlListIndex: number,
  originalUrl: string) {
  return new Promise<void>(async (resolve, reject) => {
    // Create references to event listeners, so that we can remove them in the
    // catch block if this part crashes.
    let interceptNavigations: ((req: HTTPRequest) => void) | undefined;
    let interceptPopups: ((newPage: Page | null) => void) | undefined;

    try {
      // Reference to any new tab that is opened, that can be called in the
      // following timeout if necessary.
      let ctPage: Page | undefined;

      // Before clicking, set up various event listeners to catch what happens
      // when the ad is clicked.
      // let blockNavigations: (req: HTTPRequest) => Promise<void>;

      // Set up a Chrome DevTools session (used later for popup interception)
      const cdp = await BROWSER.target().createCDPSession();

      // Reference to timeouts, so that they can be cleaned up in the next function.
      let timeout: NodeJS.Timeout, clickTimeout: NodeJS.Timeout;

      // Create a function to clean up everything we're about to add
      async function cleanUp() {
        clearTimeout(timeout);
        clearTimeout(clickTimeout);
        await cdp.send('Target.setAutoAttach', {
          waitForDebuggerOnStart: false,
          autoAttach: false,
          flatten: true
        });
        if (interceptNavigations) {
          page.off('request', interceptNavigations);
        }
        if (interceptPopups) {
          page.off('popup', interceptPopups);
        }
      }

      // Create timeout for processing overall clickthrough (including the landing page).
      // If it takes longer than this, abort handling this ad.
      timeout = setTimeout(async () => {
        if (ctPage && !ctPage.isClosed()) {
          await ctPage?.close();
        }
        await cleanUp();
        reject(new Error(`${page.url()}: Clickthrough timed out - ${CLICKTHROUGH_TIMEOUT}ms`));
      }, CLICKTHROUGH_TIMEOUT);

      // Create timeout for the click. If the click fails to do anything,
      // abort handing this ad.
      clickTimeout = setTimeout(async () => {
        if (ctPage && !ctPage.isClosed()) {
          await ctPage?.close();
        }
        await cleanUp();
        reject(new Error(`${page.url()}: Ad click timed out - ${AD_CLICK_TIMEOUT}ms`));
      }, AD_CLICK_TIMEOUT)

      // This listener handles the case where the ad tries to navigate the
      // current tab to the ad's landing page. If this happens,
      // block the navigation, and then decide what to do based on what
      // the crawl job config says.
      // Note: request interception is already enabled for all pages crawled,
      // set in src/crawler.ts.
      interceptNavigations = (req: HTTPRequest) => {
        (async () => {
          // Block navigation requests only if they are in in the top level frame
          // (iframes can also trigger this event).
          if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
            // log.verbose(`${page.url()} Intercepted navigation request: ${req.url()}`)
            // Stop the navigation from happening.
            await req.abort('aborted', 1);
            clearTimeout(clickTimeout);

            // Save the ad URL in the database.
            let db = DbClient.getInstance();
            await db.postgres.query('UPDATE ad SET url=$2 WHERE id=$1', [adId, req.url()]);

            if (FLAGS.scrapeOptions.clickAds == 'clickAndBlockLoad') {
              // If blocking ads from loading, clean up the tab and continue.
              log.verbose(`${page.url()} Intercepted and blocked ad (navigation): ${req.url()}`);
              await cleanUp();
              resolve();
              return;
            } else if (FLAGS.scrapeOptions.clickAds == 'clickAndScrapeLandingPage') {
              // Open the blocked URL in a new tab, so that we can keep the previous
              // one open.
              log.verbose(`${page.url()} Blocked attempted navigation to ${req.url()}`);
              let newPage = await BROWSER.newPage();
              let ctPageId: number | undefined;
              try {
                ctPage = newPage;
                log.debug(`${newPage.url()}: Loading and scraping popup page`);
                await newPage.goto(req.url(), {
                  referer: req.headers().referer,
                  timeout: PAGE_NAVIGATION_TIMEOUT
                });
                ctPageId = await db.archivePage({
                  timestamp: new Date(),
                  job_id: FLAGS.jobId,
                  crawl_id: CRAWL_ID,
                  url: newPage.url(),
                  original_url: newPage.url(),
                  crawl_list_index: crawlListIndex,
                  page_type: PageType.LANDING,
                  referrer_page: pageId,
                  referrer_page_url: page.url(),
                  referrer_ad: adId
                });
                await sleep(PAGE_SLEEP_TIME);
                await scrapePage(newPage, {
                  pageId: ctPageId,
                  pageType: PageType.LANDING,
                  referrerAd: adId
                });
                clearTimeout(timeout);
                resolve();
              } catch (e) {
                if (ctPageId) {
                  if (e instanceof Error) {
                    await db.updatePage(ctPageId, { error: e.message });
                  } else {
                    await db.updatePage(ctPageId, { error: (e as string) });
                  }
                }
                reject(e);
              } finally {
                await newPage.close();
                await cleanUp();
              }
            } else {
              log.warning(`${page.url()} Should not reach this point in interceptNavigations()`);
              await req.continue({}, 0);
            }
          } else {
            try {
              // Allow other unrelated requests through
              await req.continue({}, 0);
            } catch (e: any) {
              log.error(e);
            }
          }
        })();
      };
      page.on('request', interceptNavigations);

      // Next, handle the case where the ad opens a popup. We have two methods
      // for handling this, depending on the desired click behavior.

      // If we want to see the initial navigation request to get the ad URL,
      // and if we want to block the popup from loading, we need to use the
      // the Chrome DevTools protocol to auto-attach to the popup when it opens,
      // and intercept the request.

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
        try {
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
            log.verbose(`${page.url()}: Intercepted popup URL: ${request.url}`);

            // Save the ad URL in the database.
            let db = DbClient.getInstance();
            await db.postgres.query('UPDATE ad SET url=$2 WHERE id=$1', [adId, request.url]);
            log.debug(`${page.url()}: Saved ad URL for ad ${adId}`);
            if (FLAGS.scrapeOptions.clickAds == 'clickAndBlockLoad') {
              clearTimeout(clickTimeout);
              log.verbose(`${page.url()}: Aborting popup request...`);
              // If we're blocking the popup, prevent navigation from running
              await popupCdp?.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
              // Close the tab (we don't have a puppeteer-land handle to the page)
              await popupCdp?.send('Target.closeTarget', { targetId: targetInfo.targetId });
              // Success, clean up the listeners
              await cleanUp();
              resolve();
            } else {
              log.verbose(`${page.url()} Allowing popup requests to continue, letting page.on(popup) handle it...`);
              // Otherwise, disable request interception and continue.
              await popupCdp?.send('Fetch.continueRequest', {requestId});
              await popupCdp?.send('Fetch.disable');
            }
          });

          // Allow the popup to continue executing and make the navigation request
          try {
            await popupCdp.send('Runtime.runIfWaitingForDebugger');
          } catch (e) {
            // Sometimes this fails because the request is intercepted before
            // this request is sent, and the target is already closed. However,
            // in that case we successfully got the data (somehow) so we can
            // safely do nothing here.
            log.verbose(`${page.url()}: Popup navigation request caught in CDP before resuming tab. Continuing...`);
          }
        } catch (e: any) {
          log.error(e);
          await cleanUp();
        }
      });

      // If we want to allow the popup to load, we can listen for the popup
      // event in puppeteer and use that page.
      if (FLAGS.scrapeOptions.clickAds == 'clickAndScrapeLandingPage') {
        interceptPopups = (newPage) => {
          if (!newPage) {
            return;
          }

          clearTimeout(clickTimeout);

          // If the ad click opened a new tab/popup, start crawling in the new tab.
          ctPage = newPage;
          log.debug(`${newPage.url()}: Loading and scraping popup page`);
          // injectDOMListener(newPage);
          newPage.on('load', async () => {
            let db = DbClient.getInstance();
            let ctPageId;
            try {
              ctPageId = await db.archivePage({
                timestamp: new Date(),
                job_id: FLAGS.jobId,
                crawl_id: CRAWL_ID,
                url: newPage.url(),
                original_url: newPage.url(),
                crawl_list_index: crawlListIndex,
                page_type: PageType.LANDING,
                referrer_page: pageId,
                referrer_page_url: page.url(),
                referrer_ad: adId
              });
              await sleep(PAGE_SLEEP_TIME);
              await scrapePage(newPage, {
                pageId: ctPageId,
                pageType: PageType.LANDING,
                referrerAd: adId
              });
              clearTimeout(timeout);
              resolve();
            } catch (e) {
              if (ctPageId) {
                if (e instanceof Error) {
                  await db.updatePage(ctPageId, { error: e.message });
                } else {
                  await db.updatePage(ctPageId, { error: (e as string) });
                }
              }
              reject(e);
            } finally {
              if (!newPage.isClosed()) {
                await newPage.close();
              }
              await cleanUp();
            }
          });
        }
        page.on('popup', interceptPopups);
      }

      // Finally click the ad
      log.info(`${page.url()}: Clicking on ad ${adId}`);

      // Attempt to use the built-in puppeteer click.
      await ad.click({ delay: 10 });
    } catch (e: any) {
      log.error(e);
      reject(e);
      if (interceptNavigations) {
        page.off('request', interceptNavigations);
      }
      if (interceptPopups) {
        page.off('popup', interceptPopups);
      }
    }
  });
}