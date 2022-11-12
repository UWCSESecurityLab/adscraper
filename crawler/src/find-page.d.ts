import puppeteer from 'puppeteer';
/**
 * Randomly picks links from a page, opens them in a new tab, and checks if it
 * meets the criteria.
 * Returns the first link meeting the criteria
 * @param page Page to look at links from
 * @param guessCriteria Function to be evaluated on a candidate page
 * @param maxGuesses Maximum number of links to explore
 * @returns URL for the first matching page, or undefined if no page was found.
 */
export declare function randomGuessPage(page: puppeteer.Page, maxGuesses: number, guessCriteria: (page: puppeteer.Page) => Promise<boolean>): Promise<string>;
/**
 * Finds an article linked from the given page. First tries to locate an
 * RSS feed, falls back to randomly picking links.
 * When randomly picking, uses the readability library to determine if a page
 * is an article (same util used by Firefox for reader mode).
 * @param page Page to look for articles on
 * @returns Article URL, or undefined if no article was found.
 */
export declare function findArticle(page: puppeteer.Page): Promise<string>;
export declare function findPageWithAds(page: puppeteer.Page): Promise<string>;
//# sourceMappingURL=find-page.d.ts.map