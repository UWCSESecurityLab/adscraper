import path from 'path';
import { Page } from 'puppeteer';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

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
 * Scrapes the HTML of a page and screenshots it.
 * @param page The page to screenshot
 * @param screenshotDir Where the screenshot should be saved
 * @param externalScreenshotDir If crawling in a Docker container, the location
 * where the screenshot will be saved in the Docker host.
 * @param screenshotHost The hostname of the machine on which the screenshot
 * will be stored.
 * @returns A ScrapedPage containing the screenshot, HTML, and timestamp.
 */
export async function scrape(
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
    const metadata =  await img.metadata();
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
