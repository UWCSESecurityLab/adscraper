import puppeteer from 'puppeteer';
export interface AdHandles {
    clickTarget: puppeteer.ElementHandle;
    screenshotTarget: puppeteer.ElementHandle | null;
}
interface ScrapedAd {
    timestamp: Date;
    html: string;
    screenshot?: string;
    screenshot_host?: string;
    selectors?: string;
    winning_bid?: boolean;
    max_bid_price?: number;
    with_context: boolean;
    bb_x?: number;
    bb_y?: number;
    bb_height?: number;
    bb_width?: number;
}
/**
 * Scrapes the content of an ad, including HTML and screenshot data.
 * This function will automatically scroll to the ad in question, and wait
 * fo
 * @param page The page the element appears on
 * @param ad The ad/element to scroll to/scrape
 * @param screenshotDir Where the screenshot should be saved
 * @param externalScreenshotDir If the crawler is in a Docker container,
 * the directory where the screenshot actually lives, in the Docker host.
 * @param screenshotHost The hostname of the machine on which the screenshot
 * will be stored.
 * @returns A promise containing the outerHTML of the element, which resolves
 * after waiting a few seconds.
*/
export declare function scrape(page: puppeteer.Page, ad: puppeteer.ElementHandle, screenshotDir: string, externalScreenshotDir: string | undefined, screenshotHost: string, withContext: boolean): Promise<ScrapedAd>;
export {};
//# sourceMappingURL=ad-scraper.d.ts.map