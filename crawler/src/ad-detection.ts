import puppeteer from 'puppeteer';
import easylist from './easylist_selectors.json';

const combinedSelectors = easylist.concat([
  '.ob-widget',
  '[id^="rc_widget"]',
]);

/**
 * This function can be executed in the browser context to look for ads that
 * match the provided CSS selectors. The idea is to take a huge list of
 * selectors (like from Easylist) and filter them down to a small number of
 * selectors that match the ads on the page, and filter out duplicates/children.
 *
 * @param selectors CSS selectors for the elements you want.
 * @returns A much smaller array of selectors for matching elements.
 */
export async function identifyAdsInDOM(
    page: puppeteer.Page) {

  const ads: puppeteer.JSHandle<Element[]> =
    await page.evaluateHandle((selectors: string[]) => {
      try {
        // Execute all of the input query selectors and collect results in a set.
        let ads = new Set<Element>();
        selectors.forEach((selector) => {
          let matches = document.querySelectorAll(selector);
          matches.forEach((match) => {
            ads.add(match);
          });
        });

        // Remove all elements that are children of another element in the set.
        // We just want the top-most element identified as an ad.
        for (let ad of ads) {
          // For each element in the set, traverse up until it hits <body>, or another
          // element in the set.
          let removed = false;
          let current = ad;
          while (current !== document.body && current.parentNode !== null) {
            current = current.parentNode as Element;
            for (let otherAd of ads) {
              if (current === otherAd) {
                ads.delete(ad);
                removed = true;
                break;
              }
            }
            if (removed) {
              break;
            }
          }
        }
        return Array.from(ads);
      } catch (e) {
        throw e;
      }
    }, combinedSelectors);

  const numAds = await ads.evaluate((ads) => ads.length);
  const adHandles = new Set<puppeteer.ElementHandle>();
  for (let i = 0; i < numAds; i++) {
    let ad = await ads.evaluateHandle((ads, idx: number) => ads[idx], i);
    adHandles.add(ad as puppeteer.ElementHandle);
  }
  return adHandles;
}

// /**
//  * Gets ElementHandles to ads on a page, given a list of CSS selectors.
//  * @param page The page to get handles to ads from.
//  * @param selectors CSS selectors for ads on this page
//  * @returns A Map of ElementHandles->id for each matching selector
//  */
// export async function getHandlesToAds(page: puppeteer.Page, selectors: string[]) {
//   const elements = new Set<puppeteer.ElementHandle>();
//   for (let selector of selectors) {
//     let selected = await page.$(selector);
//     if (selected) {
//       elements.add(selected);
//     }
//   }
//   return elements;
// }