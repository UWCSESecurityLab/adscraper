import puppeteer from 'puppeteer';
/**
 * Attempts to find an article page from a website by finding an RSS feed.
 * First looks for an RSS feed in the HTML header, and then guesses common
 * pathnames for RSS feeds (such as on Wordpress sites)
 * @param page Page to get an RSS feed from
 * @returns URL of the article if found, undefined if not found
 */
export default function getArticleFromRSS(page: puppeteer.Page): Promise<string>;
//# sourceMappingURL=get-rss-article.d.ts.map