import puppeteer from 'puppeteer';
/**
 * This function can be executed in the browser context to look for ads that
 * match the provided CSS selectors. The idea is to take a huge list of
 * selectors (like from Easylist) and filter them down to a small number of
 * selectors that match the ads on the page, and filter out duplicates/children.
 *
 * @param selectors CSS selectors for the elements you want.
 * @returns A much smaller array of selectors for matching elements.
 */
export declare function identifyAdsInDOM(page: puppeteer.Page): Promise<Set<puppeteer.ElementHandle<Element>>>;
//# sourceMappingURL=ad-detection.d.ts.map