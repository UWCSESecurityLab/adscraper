import puppeteer from 'puppeteer';
import { ExternalDomains } from './domain-extractor.js';
/**
 * This interface contains the scraped data and metadata from an iframe. Because
 * iframes may have other iframes inside it, this interface can be a node in
 * a tree representing the nesting structure.
 */
export interface ScrapedIFrame {
    timestamp: Date;
    url: string;
    html: string;
    externals?: ExternalDomains;
    children: Array<ScrapedIFrame>;
}
/**
 * Scrapes all iframes that are the children of the provided element.
 * @param ad The ad to scrape iframes from
 * @returns A promise containing one or more ScrapedIFrames. Each ScrapedIFrame
 * may contain sub-ScrapedIFrames.
 */
export declare function scrapeIFramesInElement(ad: puppeteer.ElementHandle): Promise<ScrapedIFrame[]>;
/**
 * Scrapes an iframe and recursively scrapes any iframes within it.
 * @param iframe the Frame representing the iframe to scrape
 * @returns A promise containing the ScrapedIFrame, which will contain
 * the ScrapedIFrames of any sub-iframes.
 */
export declare function scrape(iframe: puppeteer.Frame): Promise<ScrapedIFrame>;
//# sourceMappingURL=iframe-scraper.d.ts.map