import fs from 'fs';
import { ClientConfig } from 'pg';
import { publicIpv4, publicIpv6 } from 'public-ip';
import puppeteer, { Browser } from 'puppeteer';
import sourceMapSupport from 'source-map-support';
import * as domMonitor from './ads/dom-monitor.js';
import { findArticle, findPageWithAds } from './pages/find-page.js';
import { PageType, scrapePage } from './pages/page-scraper.js';
import * as trackingEvasion from './tracking-evasion.js';
import DbClient from './util/db.js';
import * as log from './util/log.js';
import { createAsyncTimeout } from './util/timeout.js';
import { scrapeAdsOnPage } from './ads/ad-scraper.js';

sourceMapSupport.install();

export interface CrawlerFlags {
  clearCookiesBeforeCT: boolean,
  crawlArticle: boolean,
  crawlerHostname: string,
  crawlList: string,
  crawlPageWithAds: boolean,
  dataset: string,
  disableAllCookies: boolean,
  disableThirdPartyCookies: boolean,
  headless: boolean | 'new',
  jobId: number,
  label?: string,
  maxPageCrawlDepth: number,
  pgConf: ClientConfig,
  screenshotAdsWithContext: boolean
  screenshotDir: string,
  externalScreenshotDir?: string,
  skipCrawlingSeedUrl: boolean,
  warmingCrawl: boolean,
  userDataDir?: string,
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

function setupGlobals(crawlerFlags: CrawlerFlags) {
  globalThis.FLAGS = crawlerFlags;
  // How long the crawler should spend on the whole crawl (all pages/ads/CTs)
  globalThis.OVERALL_TIMEOUT = crawlerFlags.warmingCrawl ? 10 * 60 * 1000 : 25 * 60 * 1000;
  // How long the crawler can spend on each clickthrough page
  globalThis.CLICKTHROUGH_TIMEOUT = crawlerFlags.warmingCrawl ? 5 * 1000 : 30 * 1000;
  // How long the crawler should wait after clicking before trying an alternative
  // click method.
  globalThis.AD_CLICK_TIMEOUT = 5 * 1000;
  // How long the crawler can spend waiting for the HTML of a page.
  globalThis.PAGE_CRAWL_TIMEOUT = 60 * 1000;
  // How long the crawler can spend waiting for the HTML and screenshot of an ad.
  // must be greater than |AD_SLEEP_TIME|
  globalThis.AD_CRAWL_TIMEOUT = 20 * 1000;
  // How long the crawler should sleep before scraping/screenshotting an ad
  globalThis.AD_SLEEP_TIME = crawlerFlags.warmingCrawl ? 0 : 5 * 1000;
  // How long the crawler should sleep before çrawling a page
  globalThis.PAGE_SLEEP_TIME = crawlerFlags.warmingCrawl ? 0 : 10 * 1000;
  // Size of the viewport
  globalThis.VIEWPORT = { width: 1366, height: 768 };
}

export async function crawl(flags: CrawlerFlags) {
  // Validate arguments
  if (!fs.existsSync(flags.screenshotDir)) {
    console.log(`${flags.screenshotDir} is not a valid directory`);
    process.exit(1);
  }

  if (!fs.existsSync(flags.crawlList)) {
    console.log(`${flags.crawlList} does not exist.`);
    process.exit(1);
  }

  const urls = fs.readFileSync(flags.crawlList).toString().trimEnd().split('\n');
  let i = 1;
  for (let url of urls) {
    try {
      new URL(url);
    } catch (e) {
      console.log(`Invalid URL in ${flags.crawlList}, line ${i}: ${url}`);
      process.exit(1);
    }
  }

  // Initialize global variables and clients
  console.log(flags);
  setupGlobals(flags);

  const db = await DbClient.initialize(FLAGS.pgConf);

  if (FLAGS.updateCrawlerIpField) {
    await setCrawlerIpField(FLAGS.jobId);
  }

  // Open browser
  log.info('Launching browser...');
  globalThis.BROWSER = await puppeteer.launch({
    args: ['--disable-dev-shm-usage'],
    defaultViewport: VIEWPORT,
    headless: FLAGS.headless,
    userDataDir: FLAGS.userDataDir
  });
  const version = await BROWSER.version();

  log.info('Running ' + version);

  // Set up tracking/targeting evasion
  await trackingEvasion.spoofUserAgent(BROWSER);
  await trackingEvasion.disableCookies(
    BROWSER, FLAGS.disableAllCookies, FLAGS.disableThirdPartyCookies);

  // Main loop through crawl list
  for (let url of urls) {
    // Set overall timeout for this crawl list item
    let [urlTimeout, urlTimeoutId] = createAsyncTimeout(
      `${url}: overall site timeout reached`, OVERALL_TIMEOUT);

    let seedPage = await BROWSER.newPage();

    try {
      let _crawl = (async () => {
        // Insert record for this crawl list item
        try {
          let crawlId: number;
          if (!FLAGS.skipCrawlingSeedUrl) {
            crawlId = await db.insert({
              table: 'crawl',
              returning: 'id',
              data: {
                timestamp: new Date(),
                job_id: FLAGS.jobId,
                dataset: FLAGS.dataset,
                label: FLAGS.label,
                seed_url: url,
                warming_crawl: FLAGS.warmingCrawl
              }
            }) as number;
          } else {
            let crawlQuery = await db.postgres.query(`SELECT id FROM crawl WHERE job_id=$1 AND seed_url=$2 AND warming_crawl='f'`,
              [FLAGS.jobId, url]);
            crawlId = crawlQuery.rows[0].id as number;
          }

          // Open and crawl the URL
          log.info(`${url}: loading page`);
          if (!FLAGS.skipCrawlingSeedUrl && !FLAGS.warmingCrawl) {
            await domMonitor.injectDOMListener(seedPage);
          }
          await trackingEvasion.evadeHeadlessChromeDetection(seedPage);
          await seedPage.goto(url, { timeout: 60000 });

          // Crawl the page
          if (!FLAGS.skipCrawlingSeedUrl) {
            const pageId = await scrapePage(seedPage, {
              pageType: PageType.HOME,
              currentDepth: 1,
              crawlId: crawlId
            });

            await scrapeAdsOnPage(seedPage, {
              crawlId: crawlId,
              parentPageId: pageId,
              parentDepth: 1
            });

          }

          // Open and crawl articles or subpages, if applicable
          if (!FLAGS.warmingCrawl && FLAGS.crawlArticle) {
            // Find and crawl an article on the page
            const article = await findArticle(seedPage);
            if (article) {
              log.info(`${article}: loading page`);
              const articlePage = await BROWSER.newPage();
              await trackingEvasion.evadeHeadlessChromeDetection(articlePage);
              await domMonitor.injectDOMListener(articlePage);
              await articlePage.goto(article, { timeout: 60000 });
              const pageId = await scrapePage(articlePage, {
                pageType: PageType.ARTICLE,
                currentDepth: 1,
                crawlId: crawlId
              });
              await scrapeAdsOnPage(seedPage, {
                crawlId: crawlId,
                parentPageId: pageId,
                parentDepth: 1
              });
              await articlePage.close();
            } else {
              log.strError(`${url}: Couldn't find article`);
            }
          } else if (!FLAGS.warmingCrawl && FLAGS.crawlPageWithAds) {
            const urlWithAds = await findPageWithAds(seedPage);
            if (urlWithAds) {
              log.info(`${urlWithAds}: loading page`);
              const adsPage = await BROWSER.newPage();
              await trackingEvasion.evadeHeadlessChromeDetection(adsPage);
              await domMonitor.injectDOMListener(adsPage);
              await adsPage.goto(urlWithAds, { timeout: 60000 });
              const pageId = await scrapePage(adsPage, {
                pageType: PageType.SUBPAGE,
                currentDepth: 1,
                crawlId: crawlId
              });
              await scrapeAdsOnPage(seedPage, {
                crawlId: crawlId,
                parentPageId: pageId,
                parentDepth: 1
              });
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
      await seedPage.close();
    } catch (e) {
      await seedPage.close();
      continue;
    }
  }
  await BROWSER.close();
  log.info('Crawler instance completed');
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
