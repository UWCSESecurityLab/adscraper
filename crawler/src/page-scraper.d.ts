import { Page } from 'puppeteer';
export declare enum PageType {
    HOME = "home",
    ARTICLE = "article",
    SUBPAGE = "subpage",
    LANDING = "landing"
}
interface ScrapedPage {
    timestamp: Date;
    url: string;
    html: string;
    screenshot: string;
    screenshot_host: string;
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
export declare function scrape(page: Page, screenshotDir: string, externalScreenshotDir: string | undefined, screenshotHost: string): Promise<ScrapedPage>;
export {};
//# sourceMappingURL=page-scraper.d.ts.map