import path from 'path';
import { Page } from 'puppeteer';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import * as log from '../util/log.js';
import { createAsyncTimeout, sleep } from '../util/timeout.js';
import DbClient from '../util/db.js';
import urlToPathSafeStr from '../util/urlToPathSafeStr.js';
import fs from 'fs';

export enum PageType {
  MAIN = 'main',  // The URL specified in the crawl list
  SUBPAGE = 'subpage',  // A link found on the main page (article or randomly guessed page)
  LANDING = 'landing'  // An ad landing page
}

interface ScrapedPage {
  timestamp: Date,
  url: string,
  html: string,
  mhtml: string,
  screenshot: string,
  screenshot_host: string,
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
interface ScrapePageMetadata {
  pageType: PageType,
  // currentDepth: number,
  crawlId: number,
  referrerPage?: number,
  referrerAd?: number
}

/**
 * Scrapes a page and saves it in the database.
 * @param page The page to be crawled.
 * @param metadata Crawler metadata linked to this page.
 * @returns The id of the crawled page in the database.
 */
export async function scrapePage(page: Page, metadata: ScrapePageMetadata): Promise<number> {
  log.info(`${page.url()}: Scraping page`);
  await sleep(PAGE_SLEEP_TIME);
  let [timeout, timeoutId] = createAsyncTimeout<number>(
    `${page.url()}: Timed out crawling page`, PAGE_CRAWL_TIMEOUT);

  let db = DbClient.getInstance();

  const _crawlPage = (async () => {
    try {
      let pageId = -1;

      const pagesDir = path.join(
        FLAGS.outputDir,
        'job_' + FLAGS.jobId.toString(),
        'scraped_pages',
        urlToPathSafeStr(page.url())
      );
      if (!fs.existsSync(pagesDir)) {
        fs.mkdirSync(pagesDir, { recursive: true });
      }

      const scrapedPage = await scrapePageContent(
        page,
        pagesDir,
        FLAGS.crawlerHostname);

      pageId = await db.archivePage({
        crawl_id: metadata.crawlId,
        job_id: FLAGS.jobId,
        page_type: metadata.pageType,
        // depth: metadata.currentDepth,
        referrer_page: metadata.referrerPage,
        referrer_ad: metadata.referrerAd,
        ...scrapedPage
      });
      log.info(`${page.url()}: Archived page content`);
      clearTimeout(timeoutId);
      return pageId;

    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  })();
  const result = await Promise.race([timeout, _crawlPage]);
  return result;
}

/**
 * Collects the content of the page: a screenshot, the HTML content, and
 * (TODO: MHTML content).
 * @param page The page to screenshot
 * @param outputDir Path to where the screenshot and HTML files should be saved.
 * @param screenshotHost The hostname of the machine on which the screenshot
 * will be stored.
 * @returns A ScrapedPage containing the screenshot, HTML, and timestamp.
 */
async function scrapePageContent(
  page: Page,
  outputDir: string,
  // externalScreenshotDir: string | undefined,
  screenshotHost: string): Promise<ScrapedPage> {
  try {
    const pageUuid = uuidv4();
    const outputFilePrefix = path.join(outputDir, pageUuid);

    // Save HTML content
    const html = await page.content();
    const htmlFile = outputFilePrefix + '.html';
    fs.writeFileSync(htmlFile, html);

    // Save page snapshot
    const cdp = await page.target().createCDPSession();
    await cdp.send('Page.enable');
    const mhtml = (await cdp.send('Page.captureSnapshot', { format: 'mhtml' })).data;
    const mhtmlFile = outputFilePrefix + '.mhtml';
    fs.writeFileSync(mhtmlFile, mhtml);

    // Save screenshot
    const buf = await page.screenshot({ fullPage: true });
    const img = sharp(buf);
    const metadata = await img.metadata();
    let screenshotFile;
    if (metadata.height && metadata.height >= 16384) {
      screenshotFile = outputFilePrefix + '.png';
      await img.png().toFile(outputFilePrefix);
    } else {
      screenshotFile = outputFilePrefix + '.webp'
      await img.webp({ lossless: true }).toFile(screenshotFile);
    }

    return {
      timestamp: new Date(),
      url: page.url(),
      html: htmlFile,
      mhtml: mhtmlFile,
      screenshot: screenshotFile,
      screenshot_host: screenshotHost
    };
  } catch (e) {
    throw e;
  }
}
