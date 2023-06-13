import { Page } from 'puppeteer';
import rssParser from 'rss-parser';
import * as log from '../util/log.js';

/**
 * Attempts to find an article page from a website by finding an RSS feed.
 * First looks for an RSS feed in the HTML header, and then guesses common
 * pathnames for RSS feeds (such as on Wordpress sites)
 * @param page Page to get an RSS feed from
 * @returns URL of the article if found, undefined if not found
 */
export default async function getArticleFromRSS(page: Page) {
  let articleUrl = await getFromHeader(page);
  if (articleUrl) {
    return articleUrl;
  }
  return guessRssFeed(page);
}

async function getFromHeader(page: Page) {
  log.info(`${page.url()}: Attempting to get RSS feed from header`);
  let rssUrls = await page.evaluate(() => {
    let rss: string[] = [];

    let rssLinks = Array.from(document.querySelectorAll(
      'link[rel="alternate"][type="application/rss+xml"]')) as HTMLLinkElement[];
    rss.push(...rssLinks
      .filter(link => !!link.href && !link.href.includes('comments'))
      .map(link => link.href));

    let anchors = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
    rss.push(...anchors.filter(a => a.href.includes('rss')).map(a => a.href));
    return rss;
  });
  if (rssUrls.length == 0) {
    log.info(`${page.url()}: Found no feeds in header`);
    return;
  }
  log.info(`${page.url()}: Found ${rssUrls.length} feeds in header`);
  const parser = new rssParser();
  for (let rssUrl of rssUrls) {
    try {
      let feed = await parser.parseURL(rssUrl);
      if (!feed || !feed.items || feed.items.length == 0) {
        continue;
      }
      log.info(`${page.url()}: Found an article in feed at ${rssUrl}`);
      return feed.items[0].link;
    } catch(e) {
      continue;
    }
  }
  log.info(`${page.url()}: None of the feeds were valid or had articles`);
}

async function guessRssFeed(page: Page) {
  log.info(`${page.url()}: Attempting to guess RSS feeds`);
  const parser = new rssParser();
  const guessPaths = ['/feed', '/feeds', '/rss'];
  for (let path of guessPaths) {
    let guessUrl = new URL(page.url());
    guessUrl.pathname = path;
    try {
      let feed = await parser.parseURL(guessUrl.href);
      if (!feed || !feed.items || feed.items.length == 0) {
        continue;
      }
      log.info(`${page.url()}: Found an article in feed at ${guessUrl.href}`);
      return feed.items[0].link;
    } catch (e) {
      continue;
    }
  }
  log.info(`${page.url()}: Failed to guess RSS feed`);
}
