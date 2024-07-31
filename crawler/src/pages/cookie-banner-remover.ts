import { Page } from "puppeteer";
import * as log from '../util/log.js';
import cookieSelectors from './easylist_cookie_general_hide.json' assert { type: "json" };

export function removeCookieBanners(page: Page) {
  log.info(`${page.url()}: Attempting to remove cookie banners`);
  return page.evaluate((selectors: string[]) => {
    try {
      // Execute all of the input query selectors and collect results in a set.
      let cookies = new Set<Element>();
      selectors.forEach((selector) => {
        let matches = document.querySelectorAll(selector);
        matches.forEach((match) => {
          cookies.add(match);
        });
      });
      // Delete each matching element
      for (let cookie of cookies) {
        cookie.remove();
      }
    } catch (e) {
      throw e;
    }
  }, cookieSelectors);
}
