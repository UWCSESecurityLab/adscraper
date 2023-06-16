import fs from 'fs';
import { ClientConfig } from 'pg';
import { publicIpv4, publicIpv6 } from 'public-ip';
import puppeteer, { Browser, Page } from 'puppeteer';
import sourceMapSupport from 'source-map-support';
import * as domMonitor from './ads/dom-monitor.js';
import { findArticle, findPageWithAds } from './pages/find-page.js';
import { PageType, scrapePage } from './pages/page-scraper.js';
import DbClient from './util/db.js';
import * as log from './util/log.js';
import { createAsyncTimeout } from './util/timeout.js';
import { scrapeAdsOnPage } from './ads/ad-scraper.js';
import path from 'path';

sourceMapSupport.install();

export interface CrawlerFlags {
  name?: string,
  jobId: number,
  crawlId: number,
  outputDir: string,
  pgConf: ClientConfig,
  crawlerHostname: string,
  crawlListFile: string,

  chromeOptions: {
    profileDir?: string,
    headless: boolean | 'new',
  }

  crawlOptions: {
    shuffleCrawlList: boolean,
    crawlAdditionalPageWithAds: boolean,
    crawlAdditionalArticlePage: boolean
  }

  scrapeOptions: {
    scrapeSite: boolean,
    scrapeAds: boolean,
    clickAds: 'noClick' | 'clickAndBlockLoad' | 'clickAndScrapeLandingPage',
    screenshotAdsWithContext: boolean
  }
};

declare global {
  var BROWSER: Browser;
  var FLAGS: CrawlerFlags;
  var OVERALL_TIMEOUT: number;
  var PAGE_CRAWL_TIMEOUT: number;
  var AD_CRAWL_TIMEOUT: number;
  var CLICKTHROUGH_TIMEOUT: number;
  var AD_CLICK_TIMEOUT: number;
  var AD_SLEEP_TIME: number;
  var PAGE_SLEEP_TIME: number;
  var VIEWPORT: { width: number, height: number}
}

function setupGlobals(crawlerFlags: CrawlerFlags, crawlList: string[]) {
  globalThis.FLAGS = crawlerFlags;
  // How long the crawler should spend on the whole crawl (all pages/ads/CTs)
  // 15 min per item in the crawl list
  globalThis.OVERALL_TIMEOUT = crawlList.length * 15 * 60 * 1000;
  // How long the crawler can spend on each clickthrough page
  globalThis.CLICKTHROUGH_TIMEOUT = 30 * 1000;  // 30s
  // How long the crawler should wait for something to happen after clicking an ad
  globalThis.AD_CLICK_TIMEOUT = 2 * 1000;  // 2s
  // How long the crawler can spend waiting for the HTML of a page.
  globalThis.PAGE_CRAWL_TIMEOUT = 60 * 1000;  // 1min
  // How long the crawler can spend waiting for the HTML and screenshot of an ad.
  // must be greater than |AD_SLEEP_TIME|
  globalThis.AD_CRAWL_TIMEOUT = 20 * 1000;  // 20s
  // How long the crawler should sleep before scraping/screenshotting an ad
  globalThis.AD_SLEEP_TIME = 5 * 1000;  // 5s
  // How long the crawler should sleep before crawling a page
  globalThis.PAGE_SLEEP_TIME = 10 * 1000;  // 10s
  // Size of the viewport
  globalThis.VIEWPORT = { width: 1366, height: 768 };
}

export async function crawl(flags: CrawlerFlags) {
  // Validate arguments
  if (!fs.existsSync(flags.outputDir)) {
    console.log(`${flags.outputDir} is not a valid directory`);
    process.exit(1);
  }

  if (!fs.existsSync(flags.crawlListFile)) {
    console.log(`${flags.crawlListFile} does not exist.`);
    process.exit(1);
  }

  const crawlList = fs.readFileSync(flags.crawlListFile).toString().trimEnd().split('\n');
  let i = 1;
  for (let url of crawlList) {
    try {
      new URL(url);
    } catch (e) {
      console.log(`Invalid URL in ${flags.crawlListFile}, line ${i}: ${url}`);
      process.exit(1);
    }
  }

  // Initialize global variables and clients
  console.log(flags);
  setupGlobals(flags, crawlList);

  const db = await DbClient.initialize(FLAGS.pgConf);

  // Set up crawl entry, or resume from previous.
  let crawlId: number;
  let crawlListStartingIndex = 0;
  if (!FLAGS.crawlId) {
    crawlId = await db.insert({
      table: 'crawl',
      returning: 'id',
      data: {
        job_id: FLAGS.jobId,
        name: FLAGS.name,
        start_time: new Date(),
        completed: false,
        crawl_list: path.basename(FLAGS.crawlListFile),
        crawl_list_current_index: 0,
        crawl_list_length: crawlList.length,
        profile_dir: FLAGS.chromeOptions.profileDir,
        crawler_hostname: FLAGS.crawlerHostname,
        crawler_ip: await getPublicIp()
      }
    }) as number;
  } else {
    const prevCrawl = await db.postgres.query('SELECT crawl_list, crawl_list_current_index FROM crawl WHERE id=$1', [FLAGS.crawlId]);
    if (prevCrawl.rowCount !== 1) {
      console.log(`Invalid crawl_id: ${FLAGS.crawlId}`);
      process.exit(1);
    }
    if (prevCrawl.rows[0].crawl_list !== path.basename(FLAGS.crawlListFile)) {
      console.log(`Crawl list file provided does not the have same name as the original crawl. Expected: ${prevCrawl.rows[0].crawl_list}, actual: ${FLAGS.crawlListFile}`);
      process.exit(1);
    }
    if (prevCrawl.rows[0].crawl_list_length !== crawlList.length) {
      console.log(`Crawl list file provided does not the have same number of URLs as the original crawl. Expected: ${prevCrawl.rows[0].crawl_list_length}, actual: ${crawlList.length}`);
      process.exit(1);
    }
    crawlId = FLAGS.crawlId;
    crawlListStartingIndex = prevCrawl.rows[0].crawl_list_current_index;
  }

  // Open browser
  log.info('Launching browser...');
  globalThis.BROWSER = await puppeteer.launch({
    args: ['--disable-dev-shm-usage'],
    defaultViewport: VIEWPORT,
    headless: FLAGS.chromeOptions.headless,
    userDataDir: FLAGS.chromeOptions.profileDir
  });
  const version = await BROWSER.version();

  log.info('Running ' + version);

  try {
    // Main loop through crawl list
    for (let i = crawlListStartingIndex; i < crawlList.length; i++) {
      const url = crawlList[i];
      // Set overall timeout for this crawl list item
      let [urlTimeout, urlTimeoutId] = createAsyncTimeout(
        `${url}: overall site timeout reached`, OVERALL_TIMEOUT);

      let seedPage = await BROWSER.newPage();

      try {
        let _crawl = (async () => {
          // Insert record for this crawl list item
          try {
            // Open the URL and scrape it (if specified)
            const pageId = await loadAndHandlePage(url, seedPage, PageType.MAIN, crawlId);

            // Open additional pages (if specified) and scrape them (if specified)
            if (FLAGS.crawlOptions.crawlAdditionalArticlePage) {
              const articleUrl = await findArticle(seedPage);
              if (articleUrl) {
                const articlePage = await BROWSER.newPage();
                await loadAndHandlePage(articleUrl, articlePage, PageType.SUBPAGE, crawlId, pageId, seedPage.url());
                await articlePage.close();
              } else {
                log.strError(`${url}: Couldn't find article`);
              }
            }

            if (FLAGS.crawlOptions.crawlAdditionalPageWithAds) {
              const urlWithAds = await findPageWithAds(seedPage);
              if (urlWithAds) {
                const adsPage = await BROWSER.newPage();
                await loadAndHandlePage(urlWithAds, adsPage, PageType.SUBPAGE, crawlId, pageId, seedPage.url());
                await adsPage.close();
              } else {
                log.strError(`${url}: Couldn't find article`);
              }
            }
          } catch (e: any) {
            log.error(e);
            throw e;
          } finally {
            clearTimeout(urlTimeoutId);
          }
        })();
        await Promise.race([_crawl, urlTimeout]);
      } catch (e: any) {
        log.error(e);
      } finally {
        await seedPage.close();
        await db.postgres.query('UPDATE crawl SET crawl_list_current_index=$1 WHERE id=$2', [i, crawlId])
      }
    }
    await BROWSER.close();
    await db.postgres.query('UPDATE crawl SET completed=TRUE, completed_time=NOW() WHERE id=$1', [crawlId]);
  } catch (e) {
    await BROWSER.close();
    throw e;
  }
}

/**
 *
 * @param url URL to visit in the page
 * @param page Tab/Page that the URL should be visited in
 * @param pageType Whether the URL is the one in the crawl list, or an
 * additional URL that was found from a link on the initial page.
 * @param referrerPageId The page id of the page that this URL came from,
 * if this is a subpage of the crawl list page.
 * @param referrerPageUrl: The URL of the page that this URL came from.
 * if this is a subpage of the crawl list page.
 * @param crawlId ID of the crawl
 */
async function loadAndHandlePage(url: string, page: Page, pageType:
    PageType, crawlId: number, referrerPageId?: number, referrerPageUrl?: string) {
  log.info(`${url}: loading page`);
  if (FLAGS.scrapeOptions.scrapeAds) {
    await domMonitor.injectDOMListener(page);
  }
  await page.goto(url, { timeout: 60000 });

  // Crawl the page
  let pageId: number;
  if (FLAGS.scrapeOptions.scrapeSite) {
    pageId = await scrapePage(page, {
      crawlListUrl: url,
      pageType: pageType,
      crawlId: crawlId
    });
  } else {
    // If we're not scraping page, still create a database entry (without)
    // any of the scraped contents
    const db = DbClient.getInstance();
    pageId = await db.archivePage({
      job_id: FLAGS.jobId,
      crawl_id: crawlId,
      timestamp: new Date(),
      url: page.url(),
      crawl_list_url: url,
      page_type: pageType,
      referrer_page: referrerPageId,
      referrer_page_url: referrerPageUrl
    });
  }
  if (FLAGS.scrapeOptions.scrapeAds) {
    await scrapeAdsOnPage(page, {
      crawlId: crawlId,
      crawlListUrl: url,
      pageType: pageType,
      parentPageId: pageId,
    });
  }
  return pageId;
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
