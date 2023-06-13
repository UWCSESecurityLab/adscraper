import path from 'path';
import { Page } from 'puppeteer';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import * as log from '../util/log.js';
import { createAsyncTimeout, sleep } from '../util/timeout.js';
import DbClient from '../util/db.js';

export enum PageType {
  HOME = 'home',
  ARTICLE = 'article',
  SUBPAGE = 'subpage',
  LANDING = 'landing'
}

interface ScrapedPage {
  timestamp: Date,
  url: string,
  html: string
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
  currentDepth: number,
  crawlId: number,
  referrerPage?: number,
  referrerAd?: number
}
/**
 * Scrapes a page and all of the ads appearing on it, and saves the content in
 * the database. If the maximum crawl depth has not been reached, any ads on the
 * page will be clicked and crawled too.
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
      if (!FLAGS.warmingCrawl) {
        const scrapedPage = await scrapePageContent(
          page,
          FLAGS.screenshotDir,
          FLAGS.externalScreenshotDir,
          FLAGS.crawlerHostname);
        pageId = await db.archivePage({
          crawl_id: metadata.crawlId,
          job_id: FLAGS.jobId,
          page_type: metadata.pageType,
          depth: metadata.currentDepth,
          referrer_page: metadata.referrerPage,
          referrer_ad: metadata.referrerAd,
          ...scrapedPage
        });
        log.info(`${page.url()}: Archived page content`);
      }
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
 * @param screenshotDir Where the screenshot should be saved
 * @param externalScreenshotDir If crawling in a Docker container, the location
 * where the screenshot will be saved in the Docker host.
 * @param screenshotHost The hostname of the machine on which the screenshot
 * will be stored.
 * @returns A ScrapedPage containing the screenshot, HTML, and timestamp.
 */
async function scrapePageContent(
  page: Page,
  screenshotDir: string,
  externalScreenshotDir: string | undefined,
  screenshotHost: string): Promise<ScrapedPage> {
  try {
    const content = await page.content();
    const screenshotFile = uuidv4();
    const savePath = path.join(screenshotDir, screenshotFile);
    const realPath = externalScreenshotDir
      ? path.join(externalScreenshotDir, screenshotFile)
      : undefined;

    const buf = await page.screenshot({ fullPage: true });
    const img = sharp(buf);
    const metadata = await img.metadata();
    if (metadata.height && metadata.height >= 16384) {
      await img.png().toFile(savePath + '.png');
    } else {
      await img.webp({ lossless: true }).toFile(savePath + '.webp');
    }

    return {
      timestamp: new Date(),
      url: page.url(),
      html: content,
      screenshot: realPath ? realPath : savePath,
      screenshot_host: screenshotHost
    };
  } catch (e) {
    throw e;
  }
}
