import { ElementHandle } from 'puppeteer';
import { AdHandles } from './ad-scraper.js';

interface ChumboxDefinition {
  // Name of the ad network
  platform: string,
  // CSS selector for the links to click, for sub-ads in the ad
  selector: string,
  // If the link defined in |selector| does not visually cover the whole ad,
  // the number of parent elements to go up for the screenshot.
  screenshotParentDepth: number
}

// Attempt to split an ad into multiple ads, for several common types of
// chumboxes.
export async function splitChumbox(ad: ElementHandle) {
  let definitions: ChumboxDefinition[] = [
    { platform: 'adblade', selector: '.adblade-dyna a.description', screenshotParentDepth: 2},
    { platform: 'contentad', selector: '.ac_container', screenshotParentDepth: 0},
    { platform: 'feednetwork', selector: '.my6_item', screenshotParentDepth: 0},
    { platform: 'mgid', selector: '.mgline', screenshotParentDepth: 0},
    { platform: 'outbrain', selector: '.ob-dynamic-rec-container.ob-p', screenshotParentDepth: 0},
    { platform: 'revcontent', selector: '.rc-item', screenshotParentDepth: 0},
    { platform: 'taboola', selector: '.trc_spotlight_item.syndicatedItem', screenshotParentDepth: 0},
    { platform: 'zergnet', selector: '.zergentity',screenshotParentDepth: 0},
  ];

  for (let d of definitions) {
    let result = await splitFirstPartyAd(ad, d.selector, d.screenshotParentDepth);
    if (result) {
      return {
        platform: d.platform,
        adHandles: result
      }
    }
  }
  return null;
}

/**
 * Splits a chumbox ad in the first party HTML context (i.e. ads that are not
 * iframes) into multiple ads. Many native ad networks are not iframed.
 * @param container The parent element of the whole chumbox
 * @param linkSelector CSS Selector for each individual link to click
 * @param parentDepth If the link does not visually cover the whole ad,
 *                    return a parent this many levels up for screenshots.
 * @returns If the link selector matches elements, it returns a list of tuples:
 *          [link to click, element to screenshot (null if link is sufficient)].
 *          Otherwise returns null.
 */
async function splitFirstPartyAd(
  container: ElementHandle, linkSelector: string, parentDepth: number) {
  let link = await container.$$(linkSelector);
  if (link.length === 0) {
    return null;
  }

  let fullAd = await Promise.all(link.map(async (l) => {
    let parentHandle = await container.evaluateHandle((e: Element, depth: number) => {
      let current = e;
      for (let i = 0; i < depth; i++) {
        if (current.parentElement) {
          current = current.parentElement;
        }
      }
      return current;
    }, parentDepth);
    return parentHandle;
  }));
  let tuples: AdHandles[] = [];
  for (let i = 0; i < link.length; i++) {
    tuples.push({
      clickTarget: link[i],
      screenshotTarget: fullAd[i]
    });
  }
  return tuples;
}

// async function google(containingElement: ElementHandle) {
//   let adsbygoogle_outer = '[class="adsbygoogle"] iframe';
//   // the google ads iframe might be nested under this

//   const iframe = await containingElement.$('iframe[id^="google_ads"]');
//   if (!iframe) {
//     return;
//   }
//   const frame = await iframe.contentFrame();
//   if (!frame) {
//     return;
//   }
//   let textads = await frame.$$('a.rhtitle');
// }

// async function lockerdomePoll(containingElement: ElementHandle) {
//   const iframe = await containingElement.$('iframe[src^="https://lockerdome"]');
//   if (!iframe) {
//     return;
//   }
//   const frame = await iframe.contentFrame();
//   if (!frame) {
//     return;
//   }
//   return frame.$('.button-unit');
// }