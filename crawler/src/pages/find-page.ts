import { Page } from 'puppeteer';
import * as adDetection from '../ads/ad-detection.js';
import getArticleFromRSS from './get-rss-article.js';
import * as log from '../util/log.js';
import { sleep } from '../util/timeout.js';

/**
 * Randomly picks links from a page, opens them in a new tab, and checks if it
 * meets the criteria.
 * Returns the first link meeting the criteria
 * @param page Page to look at links from
 * @param guessCriteria Function to be evaluated on a candidate page
 * @param maxGuesses Maximum number of links to explore
 * @returns URL for the first matching page, or undefined if no page was found.
 */
export async function randomGuessPage(
    page: Page,
    maxGuesses: number,
    guessCriteria: (page: Page) => Promise<boolean>) {
  const sameDomainLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a'))
      .map(a => a.href)
      .filter(href => {
        try {
          return new URL(href).hostname == window.location.hostname
        } catch(e) {
          return false;
        }}
      );
  });
  if (sameDomainLinks.length === 0) {
    // log.warning(`${page.url()}: No links on page`);
    return;
  }

  const guessPage = await page.browser().newPage();
  let currentGuess = 0;
  while (sameDomainLinks.length > 0 && currentGuess < maxGuesses) {
    let idx = getRandomInt(0, sameDomainLinks.length);
    let url = sameDomainLinks.splice(idx, 1)[0];
    // log.info(`${page.url()}: Trying link ${url}`);
    try {
      await guessPage.goto(url);
      await sleep(1500);
      if (await guessCriteria(guessPage)) {
        // log.info(`${page.url()}: Found a page that met the criteria at ${url}`);
        await guessPage.close();
        return url;
      }
    } catch (e: any) {
      if (e.name === 'TimeoutError') {
        // log.info(`${page.url()}: TimeoutError - did not find a page meeting the criteria at ${url}`);
        continue;
      } else {
        throw(e);
      }
    }
    // log.info(`${page.url()}: Did not find a page meeting the criteria at ${url}`);
    currentGuess++;
  }
  if (currentGuess !== maxGuesses) {
    // log.warning(`${page.url()}: Did not find a page meeting the criteria in ${maxGuesses} guesses`);
  } else {
    // log.warning(`${page.url()}: None of the links on the page met the criteria`);
  }
}

/**
 * Finds an article linked from the given page. First tries to locate an
 * RSS feed, falls back to randomly picking links.
 * When randomly picking, uses the readability library to determine if a page
 * is an article (same util used by Firefox for reader mode).
 * @param page Page to look for articles on
 * @returns Article URL, or undefined if no article was found.
 */
export async function findArticle(page: Page) {
  let articleUrl: string | undefined;

  log.info(`${page.url()}: Looking for article via RSS`);
  articleUrl = await getArticleFromRSS(page);
  if (articleUrl) {
    log.info(`${page.url()}: Successfully found page with ads: ${articleUrl}`);
    return articleUrl;
  }

  log.info(`${page.url()}: No RSS feed available, for article by randomly guessing links`);
  let guessUrl = await randomGuessPage(page, 20, async (page: Page) => {
    await page.evaluate(isReaderableScript);
    return page.evaluate(() => {
      // @ts-ignore
      return isProbablyReaderable(document);
    });
  });
  log.info(`${page.url()}: Guessing that this page is an article: ${articleUrl}`);
  return guessUrl;
}

export async function findPageWithAds(page: Page) {
  log.info(`${page.url()}: Finding random page with ads on it`);
  return randomGuessPage(page, 20, async (page: Page) => {
    const ads = await adDetection.identifyAdsInDOM(page)
    return ads.size > 0;
  });
}

function getRandomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

const isReaderableScript = `
    /* eslint-env es6:false */
    /* globals exports */
    /*
    * Copyright (c) 2010 Arc90 Inc
    *
    * Licensed under the Apache License, Version 2.0 (the "License");
    * you may not use this file except in compliance with the License.
    * You may obtain a copy of the License at
    *
    *     http://www.apache.org/licenses/LICENSE-2.0
    *
    * Unless required by applicable law or agreed to in writing, software
    * distributed under the License is distributed on an "AS IS" BASIS,
    * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    * See the License for the specific language governing permissions and
    * limitations under the License.
    */

    /*
    * This code is heavily based on Arc90's readability.js (1.7.1) script
    * available at: http://code.google.com/p/arc90labs-readability
    */

    var REGEXPS = {
      // NOTE: These two regular expressions are duplicated in
      // Readability.js. Please keep both copies in sync.
      unlikelyCandidates: /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i,
      okMaybeItsACandidate: /and|article|body|column|content|main|shadow/i,
    };

    function isNodeVisible(node) {
      // Have to null-check node.style to deal with SVG and MathML nodes.
      return (!node.style || node.style.display != "none") && !node.hasAttribute("hidden")
        && (!node.hasAttribute("aria-hidden") || node.getAttribute("aria-hidden") != "true");
    }

    /**
     * Decides whether or not the document is reader-able without parsing the whole thing.
     *
     * @return boolean Whether or not we suspect Readability.parse() will suceeed at returning an article object.
     */
    function isProbablyReaderable(doc, isVisible) {
      if (!isVisible) {
        isVisible = isNodeVisible;
      }

      var nodes = doc.querySelectorAll("p, pre");

      // Get <div> nodes which have <br> node(s) and append them into the 'nodes' variable.
      // Some articles' DOM structures might look like
      // <div>
      //   Sentences<br>
      //   <br>
      //   Sentences<br>
      // </div>
      var brNodes = doc.querySelectorAll("div > br");
      if (brNodes.length) {
        var set = new Set(nodes);
        [].forEach.call(brNodes, function(node) {
          set.add(node.parentNode);
        });
        nodes = Array.from(set);
      }

      var score = 0;
      // This is a little cheeky, we use the accumulator 'score' to decide what to return from
      // this callback:
      return [].some.call(nodes, function(node) {
        if (!isVisible(node))
          return false;

        var matchString = node.className + " " + node.id;
        if (REGEXPS.unlikelyCandidates.test(matchString) &&
            !REGEXPS.okMaybeItsACandidate.test(matchString)) {
          return false;
        }

        if (node.matches("li p")) {
          return false;
        }

        var textContentLength = node.textContent.trim().length;
        if (textContentLength < 140) {
          return false;
        }

        score += Math.sqrt(textContentLength - 140);

        if (score > 20) {
          return true;
        }
        return false;
      });
    }

    if (typeof exports === "object") {
      exports.isProbablyReaderable = isProbablyReaderable;
    }
    `;