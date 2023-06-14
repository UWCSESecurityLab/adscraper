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

sourceMapSupport.install();

export interface CrawlerFlags {
  jobId: number,
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

  updateCrawlerIpField: boolean
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

  if (FLAGS.updateCrawlerIpField) {
    await setCrawlerIpField(FLAGS.jobId);
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

  // Main loop through crawl list
  for (let url of crawlList) {
    // Set overall timeout for this crawl list item
    let [urlTimeout, urlTimeoutId] = createAsyncTimeout(
      `${url}: overall site timeout reached`, OVERALL_TIMEOUT);

    let seedPage = await BROWSER.newPage();

    try {
      let _crawl = (async () => {
        // Insert record for this crawl list item
        try {
          let crawlId: number;
          crawlId = await db.insert({
            table: 'crawl',
            returning: 'id',
            data: {
              timestamp: new Date(),
              job_id: FLAGS.jobId,
              seed_url: url,
            }
          }) as number;

          // Open the URL and scrape it (if specified)
          await loadAndHandlePage(url, seedPage, PageType.MAIN, crawlId);

          // Open additional pages (if specified) and scrape them (if specified)
          if (FLAGS.crawlOptions.crawlAdditionalArticlePage) {
            const article = await findArticle(seedPage);
            if (article) {
              const articlePage = await BROWSER.newPage();
              await loadAndHandlePage(url, articlePage, PageType.SUBPAGE, crawlId);
              await articlePage.close();
            } else {
              log.strError(`${url}: Couldn't find article`);
            }
          }

          if (FLAGS.crawlOptions.crawlAdditionalPageWithAds) {
            const urlWithAds = await findPageWithAds(seedPage);
            if (urlWithAds) {
              const adsPage = await BROWSER.newPage();
              await loadAndHandlePage(url, adsPage, PageType.SUBPAGE, crawlId);
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
    }
  }
  await BROWSER.close();
  log.info('Crawler instance completed');
}

/**
 *
 * @param url URL to visit in the page
 * @param page Tab/Page that the URL should be visited in
 * @param pageType Whether the URL is the one in the crawl list, or an
 * additional URL that was found from a link on the initial page.
 * @param crawlId ID of the crawl
 */
async function loadAndHandlePage(url: string, page: Page, pageType:
    PageType, crawlId: number) {
  log.info(`${url}: loading page`);
  if (FLAGS.scrapeOptions.scrapeAds) {
    await domMonitor.injectDOMListener(page);
  }
  await page.goto(url, { timeout: 60000 });

  // Crawl the page
  let pageId: number | undefined;
  if (FLAGS.scrapeOptions.scrapeSite) {
    pageId = await scrapePage(page, {
      pageType: pageType,
      crawlId: crawlId
    });
  }
  if (FLAGS.scrapeOptions.scrapeAds) {
    await scrapeAdsOnPage(page, {
      crawlId: crawlId,
      parentPageId: pageId,
      pageType: pageType,
    });
  }
}

async function setCrawlerIpField(jobId: number) {
  const dbClient = DbClient.getInstance();
  try {
    const ip = await getPublicIp();
    if (!ip) {
      console.log('Couldn\'t find public IP address');
      return;
    }
    console.log(ip)
    await dbClient.postgres.query('UPDATE job SET crawler_ip=$1 WHERE id=$2;', [ip, jobId]);
    console.log('updated ip');
  } catch (e) {
    console.log(e);
  }
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
