import csvParser from 'csv-parser';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ClientConfig } from 'pg';
import { publicIpv4, publicIpv6 } from 'public-ip';
import { Browser, HTTPRequest, Page } from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import sourceMapSupport from 'source-map-support';
import { scrapeAdsOnPage } from './ads/ad-scraper.js';
import { findArticle, findPageWithAds } from './pages/find-page.js';
import { PageType, scrapePage } from './pages/page-scraper.js';
import DbClient, { WebRequest } from './util/db.js';
import * as log from './util/log.js';
import { createAsyncTimeout, sleep } from './util/timeout.js';

sourceMapSupport.install();

export interface CrawlerFlags {
  crawlName?: string,
  jobId: number,
  crawlId?: number,
  outputDir: string,
  url?: string,
  adId?: number,
  urlList?: string,
  adUrlList?: string,
  logLevel?: log.LogLevel,

  chromeOptions: {
    profileDir?: string,
    headless: boolean | 'new',
    executablePath?: string
  }

  crawlOptions: {
    shuffleCrawlList: boolean,
    findAndCrawlPageWithAds: boolean,
    findAndCrawlArticlePage: boolean
  }

  scrapeOptions: {
    scrapeSite: boolean,
    scrapeAds: boolean,
    clickAds: 'noClick' | 'clickAndBlockLoad' | 'clickAndScrapeLandingPage',
    screenshotAdsWithContext: boolean,
    captureThirdPartyRequests: boolean
  }
  profileOptions?: any
};

declare global {
  var BROWSER: Browser;
  var FLAGS: CrawlerFlags;
  var PAGE_NAVIGATION_TIMEOUT: number;
  var PAGE_SCRAPE_TIMEOUT: number;
  var AD_SCRAPE_TIMEOUT: number;
  var CLICKTHROUGH_TIMEOUT: number;
  var AD_CLICK_TIMEOUT: number;
  var AD_SLEEP_TIME: number;
  var PAGE_SLEEP_TIME: number;
  var VIEWPORT: { width: number, height: number}
  var CRAWL_ID: number;
  var LOG_LEVEL: log.LogLevel;
}

function setupGlobals(crawlerFlags: CrawlerFlags) {
  globalThis.FLAGS = crawlerFlags;
  // How long the crawler can spend on each clickthrough page
  globalThis.CLICKTHROUGH_TIMEOUT = 60 * 1000;  // 60s
  // How long the crawler should wait for something to happen after clicking an ad
  globalThis.AD_CLICK_TIMEOUT = 10 * 1000;  // 10s
  // How long the crawler should wait for a page to load.
  globalThis.PAGE_NAVIGATION_TIMEOUT = 3 * 60 * 1000;  // 3min
  // How long the crawler can spend scraping the HTML of a page.
  globalThis.PAGE_SCRAPE_TIMEOUT = 2 * 60 * 1000;  // 2min
  // How long the crawler can spend scraping the HTML content and screenshot of an ad.
  // must be greater than |AD_SLEEP_TIME|
  globalThis.AD_SCRAPE_TIMEOUT = 20 * 1000;  // 20s
  // How long the crawler should sleep before scraping/screenshotting an ad
  globalThis.AD_SLEEP_TIME = 5 * 1000;  // 5s
  // How long the crawler should sleep before scraping a page
  globalThis.PAGE_SLEEP_TIME = 10 * 1000;  // 10s
  // Size of the viewport
  globalThis.VIEWPORT = { width: 1366, height: 768 };
  globalThis.LOG_LEVEL = crawlerFlags.logLevel ? crawlerFlags.logLevel : log.LogLevel.INFO;
}

export async function crawl(flags: CrawlerFlags, pgConf: ClientConfig) {
  // Initialize global variables and clients
  // console.log(flags);
  setupGlobals(flags);

  // Validate arguments
  if (!fs.existsSync(flags.outputDir)) {
    console.log(`${flags.outputDir} is not a valid directory`);
    process.exit(1);
  }
  // Check if output directory is writeable. If not, check the file permissions
  // (or mount settings, if running in a container).
  try {
    fs.accessSync(flags.outputDir, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    console.error(`${flags.outputDir} is not writable`);
    process.exit(1);
  }

  const db = await DbClient.initialize(pgConf);

  // Read crawl list from args
  let crawlListFile: string = '';
  let crawlList: string[] = [];
  let crawlListAdIds: number[] = [];
  let isAdUrlCrawl = false;

  if (flags.url) {
    crawlList = [flags.url];
    if (flags.adId) {
      crawlListAdIds = [flags.adId];
      isAdUrlCrawl = true;
    }
  } else if (flags.urlList) {
    if (!fs.existsSync(flags.urlList)) {
      console.log(`${flags.urlList} does not exist.`);
      process.exit(1);
    }
    crawlList = fs.readFileSync(flags.urlList).toString()
      .trimEnd()
      .split('\n')
      .filter((url: string) => url.length > 0);
    crawlListFile = flags.urlList;
  } else if (flags.adUrlList) {
    crawlListFile = flags.adUrlList;
    if (!fs.existsSync(crawlListFile)) {
      console.log(`${crawlListFile} does not exist.`);
      process.exit(1);
    }
    await (new Promise<void>((resolve, reject) => {
      fs.createReadStream(crawlListFile)
        .pipe(csvParser())
        .on('data', data => {
          if (!data.ad_id) {
            reject(new Error('ad_id column missing from adUrlList'));
          }
          if (!data.url) {
            reject(new Error('url column missing from adUrlList'));
          }
          crawlList.push(data.url);
          crawlListAdIds.push(data.ad_id);
        }).on('end', () => {
          resolve();
        });
    }));
    isAdUrlCrawl = true;
  } else {
    log.strError('Must provide one of the following crawl inputs: url, urlList, or adUrlList');
    process.exit(1);
  }

  // Validate crawl list urls
  let i = 1;
  for (let url of crawlList) {
    try {
      new URL(url);
    } catch (e) {
      log.strError(`Invalid URL in crawl list ${crawlListFile} at line ${i}: ${url}`);
      process.exit(1);
    }
  }

  // Now that the length of the crawl list is known, set the global timeout
  const OVERALL_TIMEOUT = crawlList.length * 15 * 60 * 1000;

  // Set up crawl entry, or resume from previous.
  // let crawlId: number;
  let crawlListStartingIndex = 0;
  if (!FLAGS.crawlId) {
    globalThis.CRAWL_ID = await db.insert({
      table: 'crawl',
      returning: 'id',
      data: {
        job_id: FLAGS.jobId,
        name: FLAGS.crawlName,
        start_time: new Date(),
        completed: false,
        crawl_list: crawlListFile,
        crawl_list_current_index: 0,
        crawl_list_length: crawlList.length,
        profile_dir: FLAGS.chromeOptions.profileDir,
        crawler_hostname: os.hostname(),
        crawler_ip: await getPublicIp()
      }
    }) as number;
  } else {
    const prevCrawl = await db.postgres.query('SELECT * FROM crawl WHERE id=$1', [FLAGS.crawlId]);
    // Check if crawl inputs match the stored inputs of the previous crawl
    if (prevCrawl.rowCount !== 1) {
      console.log(`Invalid crawl_id: ${FLAGS.crawlId}`);
      process.exit(1);
    }
    if (path.basename(prevCrawl.rows[0].crawl_list) != path.basename(crawlListFile)) {
      console.log(`Crawl list file provided does not the have same name as the original crawl. Expected: ${path.basename(prevCrawl.rows[0].crawl_list)}, actual: ${path.basename(crawlListFile)}`);
      process.exit(1);
    }
    if (prevCrawl.rows[0].crawl_list_length != crawlList.length) {
      console.log(`Crawl list file provided does not the have same number of URLs as the original crawl. Expected: ${prevCrawl.rows[0].crawl_list_length}, actual: ${crawlList.length}`);
      process.exit(1);
    }
    globalThis.CRAWL_ID = FLAGS.crawlId;
    crawlListStartingIndex = prevCrawl.rows[0].crawl_list_current_index;
  }

  // Open browser
  log.info('Launching browser...');

  puppeteerExtra.default.use(StealthPlugin())

  globalThis.BROWSER = await puppeteerExtra.default.launch({
    args: ['--disable-dev-shm-usage'],
    defaultViewport: VIEWPORT,
    headless: FLAGS.chromeOptions.headless,
    handleSIGINT: false,
    userDataDir: FLAGS.chromeOptions.profileDir,
    executablePath: FLAGS.chromeOptions.executablePath
  });

  process.on('SIGINT', async () => {
    console.log('SIGINT received, closing browser...');
    await BROWSER.close();
    process.exit();
  });

  const version = await BROWSER.version();
  log.info('Running ' + version);

  try {
    // Main loop through crawl list
    for (let i = crawlListStartingIndex; i < crawlList.length; i++) {
      const url = crawlList[i];

      let prevAdId = isAdUrlCrawl ? crawlListAdIds[i] : undefined;

      // Set overall timeout for this crawl list item
      let [urlTimeout, urlTimeoutId] = createAsyncTimeout(
        `${url}: overall site timeout reached`, OVERALL_TIMEOUT);

      let seedPage = await BROWSER.newPage();

      try {
        let _crawl = (async () => {
          // Insert record for this crawl list item
          try {
            // Open the URL and scrape it (if specified)
            let pageId;
            if (isAdUrlCrawl) {
              pageId = await loadAndHandlePage(url, seedPage, { pageType: PageType.LANDING, referrerAd: prevAdId });
            } else {
              pageId = await loadAndHandlePage(url, seedPage, { pageType: PageType.MAIN });
            }

            // Open additional pages (if specified) and scrape them (if specified)
            if (FLAGS.crawlOptions.findAndCrawlArticlePage) {
              const articleUrl = await findArticle(seedPage);
              if (articleUrl) {
                const articlePage = await BROWSER.newPage();
                await loadAndHandlePage(articleUrl, articlePage, {
                  pageType: PageType.SUBPAGE,
                  referrerPageId: pageId,
                  referrerPageUrl: seedPage.url()
                });
                await articlePage.close();
              } else {
                log.strError(`${url}: Couldn't find article`);
              }
            }

            if (FLAGS.crawlOptions.findAndCrawlPageWithAds) {
              const urlWithAds = await findPageWithAds(seedPage);
              if (urlWithAds) {
                const adsPage = await BROWSER.newPage();
                await loadAndHandlePage(urlWithAds, adsPage, {
                  pageType: PageType.SUBPAGE,
                  referrerPageId: pageId,
                  referrerPageUrl: seedPage.url()
                });
                await adsPage.close();
              } else {
                log.strError(`${url}: Couldn't find article`);
              }
            }
          } catch (e: any) {
            log.error(e, seedPage.url());
          } finally {
            clearTimeout(urlTimeoutId);
          }
        })();
        await Promise.race([_crawl, urlTimeout]);
      } catch (e: any) {
        log.error(e, seedPage.url());
      } finally {
        await db.postgres.query('UPDATE crawl SET crawl_list_current_index=$1 WHERE id=$2', [i+1, CRAWL_ID]);
        seedPage.close();
      }
    }
    await db.postgres.query('UPDATE crawl SET completed=TRUE, completed_time=$1 WHERE id=$2', [new Date(), CRAWL_ID]);
    // await BROWSER.close();
  } catch (e) {
    // await BROWSER.close();
    throw e;
  }
}

/**
 * @param pageType Whether the URL is the one in the crawl list, or an
 * additional URL that was found from a link on the initial page.
 * @param referrerPageId The page id of the page that this URL came from,
 * if this is a subpage of the crawl list page.
 * @param referrerPageUrl: The URL of the page that this URL came from.
 * if this is a subpage of the crawl list page.
 */
interface LoadPageMetadata {
  pageType: PageType,
  referrerPageId?: number,
  referrerPageUrl?: string,
  referrerAd?: number
}

/**
 *
 * @param url URL to visit in the page
 * @param page Tab/Page that the URL should be visited in
 * @param metadata Crawl metadata
 * @returns The page ID of the crawled page in the database
 */
async function loadAndHandlePage(url: string, page: Page, metadata: LoadPageMetadata) {
  log.info(`${url}: Loading page`);
  // if (FLAGS.scrapeOptions.scrapeAds) {
  //   await domMonitor.injectDOMListener(page);
  // }

  // Create an initial entry for the page in the database, to be updated later
  // with the page contents (or any errors encountered)
  const db = DbClient.getInstance();
  const pageId = await db.archivePage({
    timestamp: new Date(),
    job_id: FLAGS.jobId,
    crawl_id: CRAWL_ID,
    original_url: url,
    page_type: metadata.pageType,
    referrer_page: metadata.referrerPageId,
    referrer_page_url: metadata.referrerPageUrl,
    referrer_ad: metadata.referrerAd
  });

  try {
    // Set up request interception for capturing third party requests
    await page.setRequestInterception(true);
    let requests: WebRequest[] = [];
    const captureThirdPartyRequests = async (request: HTTPRequest) => {
      // Exit if request capture is disabled
      if (!FLAGS.scrapeOptions.captureThirdPartyRequests) {
        request.continue(undefined, 0);
        return;
      }

      // Exit if request is navigating this tab
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        request.continue(undefined, 0);
        return;
      }

      // Exclude same origin requests
      if (new URL(request.url()).origin == new URL(page.url()).origin) {
        request.continue(undefined, 0);
        return;
      }

      requests.push({
        timestamp: new Date(),
        parent_page: -1, // placeholder
        initiator: page.url(),
        target_url: request.url(),
        resource_type: request.resourceType(),
      });
      request.continue(undefined, 0);
    };
    page.on('request', captureThirdPartyRequests);

    await page.goto(url, { timeout: globalThis.PAGE_NAVIGATION_TIMEOUT });
    await sleep(PAGE_SLEEP_TIME);
    log.info(`${url}: Page finished loading`)
    await scrollDownPage(page);

    // Scrape the page
    if (FLAGS.scrapeOptions.scrapeSite) {
      await scrapePage(page, {
        pageId: pageId,
        pageType: metadata.pageType,
        referrerAd: metadata.referrerAd
      });
    } else {
      // If not scraping the page, update the contents with the real URL.
      await db.updatePage(pageId, {
        timestamp: new Date(),
        url: page.url(),
      });
    }

    // Scrape ads
    if (FLAGS.scrapeOptions.scrapeAds) {
      await scrapeAdsOnPage(page, {
        originalUrl: url,
        pageType: metadata.pageType,
        parentPageId: pageId,
      });
    }

    // Save third party requests
    if (FLAGS.scrapeOptions.captureThirdPartyRequests) {
      log.info(`${url}: Saving ${requests.length} same-site and cross-site requests`);
      const db = DbClient.getInstance();
      for (let request of requests) {
        request.parent_page = pageId;
        await db.archiveRequest(request);
      }
    }

    // Disabled this code, because sometimes disabling request interception would hang
    // and cause puppeteer to lose connection to the browser. AFAIK there is no
    // harm in leaving request interception enabled because the page will be
    // closed immediately afterward.
    // // Clean up event listeners
    // log.verbose(`${url}: Cleaning up request listeners`);
    // page.removeAllListeners('request');
    // log.verbose(`${url}: Disabling request interception`);
    // await page.setRequestInterception(false);
    return pageId;
  } catch (e) {
    if (e instanceof Error) {
      await db.updatePage(pageId, { error: e.message });
    } else {
      await db.updatePage(pageId, { error: (e as string) });
    }
    throw e;
  }
}

async function scrollDownPage(page: Page) {
  log.info(`${page.url()}: Scrolling page from top to bottom`);
  let innerHeight = await page.evaluate(() => window.innerHeight);
  let scrollY = await page.evaluate(() => window.scrollY);
  let scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  let i = 0;
  // Scroll until at the bottom of the page or 30 iterations pass
  while (scrollY + innerHeight < scrollHeight && i < 30) {
    // set a screen position to scroll from
    let xloc = randrange(50, 100);
    let yloc = randrange(50, 100);

    // Scroll a random amount
    let ydelta = randrange(200, 400);
    // puppeteer provides current mouse position to wheel mouse event
    await page.mouse.move(xloc, yloc);
    await page.mouse.wheel({ deltaY: ydelta });
    await sleep(1000);

    // innerHeight = await page.evaluate(() => window.innerHeight);
    scrollY = await page.evaluate(() => window.scrollY);
    // scrollHeight = await page.evaluate(() => document.body.scrollHeight);
    i += 1;
  }
}

function randrange(low: number, high: number): number {
  return Math.random() * (high - low) + low;
}

async function getPublicIp() {
  try {
    let v4 = await publicIpv4();
    if (v4) {
      return v4;
    }
  } catch (e) {
    console.log(e);
    try {
      let v6 = await publicIpv6();
      if (v6) {
        return v6;
      }
    } catch (e) {
      console.log(e);
      return null;
    }
  }
}
