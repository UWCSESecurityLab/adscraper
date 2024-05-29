import path from 'path';
import { Page } from 'puppeteer';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import * as log from '../util/log.js';
import { createAsyncTimeout, sleep } from '../util/timeout.js';
import DbClient from '../util/db.js';
import urlToPathSafeStr from '../util/urlToPathSafeStr.js';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import getCrawlOutputDirectory from '../util/getCrawlOutputDirectory.js';

export enum PageType {
  MAIN = 'main',  // The URL specified in the crawl list
  SUBPAGE = 'subpage',  // A link found on the main page (article or randomly guessed page)
  LANDING = 'landing'  // An ad landing page
}

interface ScrapedPage {
  timestamp: Date,
  url: string,
  html: string,
  mhtml?: string,
  screenshot: string,
}

/**
 * @property pageType: Type of page (e.g. home page, article)
 * @property referrerPage: If this is a subpage or clickthrough page, the id of the page
 * page that linked to this page.
 * @property referrerPageUrl: URL of the referrerPage.
 * @property referrerAd: If this is a clickthrough page, the id of the ad
 * that linked to this page.
 */
interface ScrapePageMetadata {
  pageId: number,
  pageType: PageType,
  referrerAd?: number
}

/**
 * Scrapes a page and saves it in the database.
 * @param page The page to be crawled.
 * @returns A ScrapedPage object containing the file locations of the scraped
 * content and other metadata.
 */
export async function scrapePage(page: Page, metadata: ScrapePageMetadata) {
  log.info(`${page.url()}: Scraping page`);
  let [timeout, timeoutId] = createAsyncTimeout<ScrapedPage>(
    `${page.url()}: Timed out scraping page`, PAGE_SCRAPE_TIMEOUT);

  const _crawlPage = (async () => {
    try {
      // Determine the name of the directory to store page content in.
      let pagesDir;
      let filename = undefined;
      if (metadata.pageType == PageType.LANDING) {
        // Store landing pages with the associated ad
        pagesDir = path.join(
          await getCrawlOutputDirectory(metadata.referrerAd),
          'scraped_ads/ad_' + metadata.referrerAd);
        filename = `ad_${metadata.referrerAd}_landing_page`;
      } else {
        // Store other pages in their own directory
        pagesDir = path.join(
          await getCrawlOutputDirectory(),
          'scraped_pages',
          urlToPathSafeStr(page.url())
        );
      }

      // Get the full path
      let fullPagesDir = path.join(FLAGS.outputDir, pagesDir);
      if (!existsSync(fullPagesDir)) {
        await fs.mkdir(fullPagesDir, { recursive: true });
      }

      // Scrape the page
      const scrapedPage = await scrapePageContent(
        page,
        fullPagesDir,
        filename);

      log.debug(`${page.url()}: Scraped page content`);
      clearTimeout(timeoutId);
      const db = DbClient.getInstance();
      await db.updatePage(metadata.pageId, scrapedPage);
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  })();
  await Promise.race([timeout, _crawlPage]);
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
  outputFilename?: string): Promise<ScrapedPage> {
  try {
    const filename = outputFilename ? outputFilename : uuidv4();
    // const outputPathPrefix = path.join(outputDir, filename);

    // Save HTML content
    const html = await page.content();
    const htmlFile = path.join(outputDir, filename + '_document.html');
    await fs.writeFile(htmlFile, html);

    // Save page snapshot
    // const cdp = await page.target().createCDPSession();
    // await cdp.send('Page.enable');
    // const mhtml = (await cdp.send('Page.captureSnapshot', { format: 'mhtml' })).data;
    // const mhtmlFile = path.join(outputDir, filename + '_snapshot.mhtml');
    // fs.writeFileSync(mhtmlFile, mhtml);

    // Save screenshot
    const buf = await page.screenshot({ fullPage: true });
    const img = sharp(buf);
    const metadata = await img.metadata();
    let screenshotFile;
    if (metadata.height && metadata.height >= 16384) {
      screenshotFile = path.join(outputDir, filename + '_screenshot.png');
      await img.png().toFile(screenshotFile);
    } else {
      screenshotFile = path.join(outputDir, filename + '_screenshot.webp');
      await img.webp({ lossless: true }).toFile(screenshotFile);
    }

    return {
      timestamp: new Date(),
      url: page.url(),
      // Save relative path to the files in the database
      html: htmlFile.replace(`${FLAGS.outputDir}/`, ''),
      // mhtml: mhtmlFile.replace(`${FLAGS.outputDir}/`, ''),
      screenshot: screenshotFile.replace(`${FLAGS.outputDir}/`, ''),
    };
  } catch (e) {
    throw e;
  }
}
