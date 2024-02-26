import { Page } from 'puppeteer';
import * as adDetection from '../ads/ad-detection.js';
import getArticleFromRSS from './get-rss-article.js';
import * as log from '../util/log.js';
import { sleep } from '../util/timeout.js';

// This class encapsulates the logic for searching for subpages to crawl.
// Namely, each instance tracks which URLs have already been considered, and
// will skip them on subsequent calls, to avoid reconsidering pages previously
// rejected.
export default class SubpageExplorer {
  prevGuesses: Set<string>;

  constructor() {
    this.prevGuesses = new Set<string>();
  }

  /**
   * Randomly picks links from a page, opens them in a new tab, and checks if it
   * meets the criteria.
   * Returns the first link meeting the criteria
   * @param page Page to look at links from
   * @param maxGuesses Maximum number of links to explore
   * @param pageCriteria Function to be evaluated on a candidate page
   * @param optionalLinkCriteria Function to be evaluated on a candidate URL;
   * optional meaning if no links fit the criteria, this filter will be ignored.
   * @returns URL for the first matching page, or undefined if no page was found.
   */
  async randomGuessPage(
      page: Page,
      maxGuesses: number,
      pageCriteria: (page: Page) => Promise<boolean>,
      optionalLinkCriteria?: (url: string) => boolean): Promise<string | undefined> {
    // Get all links on the page that share the same hostname
    const sameOriginLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .map(a => a.href)
        .filter(href => {
          try {
            return new URL(href).hostname == window.location.hostname
          } catch (e) {
            return false;
          }
        });
    });

    // Filter out links that have previously been explored
    let validLinks = sameOriginLinks.filter(href => !this.prevGuesses.has(href));

    let linksToExplore: string[] = validLinks;

    // Filter on optional link criteria if provided. If no links meet the
    // criteria, use the original set of valid links.
    if (optionalLinkCriteria) {
      let filteredLinks = validLinks.filter(optionalLinkCriteria);
      if (filteredLinks.length > 0) {
        log.verbose(`${page.url()}: ${filteredLinks.length} links met the optional criteria`);
        linksToExplore = filteredLinks;
      } else {
        log.verbose(`${page.url()}: No links met the optional criteria; using all links`);
      }
    }

    if (linksToExplore.length === 0) {
      log.verbose(`${page.url()}: no subpages explored; could not find links on page`);
      return;
    }

    const guessPage = await page.browser().newPage();
    let currentGuess = 0;
    while (linksToExplore.length > 0 && currentGuess < maxGuesses) {
      let idx = getRandomInt(0, linksToExplore.length);
      let url = linksToExplore.splice(idx, 1)[0];
      // log.info(`${page.url()}: Trying link ${url}`);
      try {
        await guessPage.goto(url, {timeout: globalThis.PAGE_NAVIGATION_TIMEOUT});
        this.prevGuesses.add(url);
        await sleep(1500);
        if (await pageCriteria(guessPage)) {
          log.verbose(`${page.url()}: Found a subpage that met the criteria at ${url}`);
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
      // log.verbose(`${page.url()}: Did not find a page meeting the criteria at ${url}`);
      currentGuess++;
    }
    // if (currentGuess !== maxGuesses) {
    //   // log.verbose(`${page.url()}: Did not find a page meeting the criteria in ${maxGuesses} guesses`);
    // } else {
    //   // log.verbose(`${page.url()}: None of the links on the page met the criteria`);
    // }
  }

  /**
   * Finds an article linked from the given page. First tries to locate an
   * RSS feed, falls back to randomly picking links.
   * When randomly picking, uses the readability library to determine if a page
   * is an article (same util used by Firefox for reader mode).
   * @param page Page to look for articles on
   * @returns Article URL, or undefined if no article was found.
   */
  async findArticle(page: Page) {
    let articleUrl: string | undefined;

    log.verbose(`${page.url()}: Looking for article via RSS`);
    articleUrl = await getArticleFromRSS(page);
    if (articleUrl) {
      log.verbose(`${page.url()}: Successfully found page with ads: ${articleUrl}`);
      return articleUrl;
    }

    log.verbose(`${page.url()}: No RSS feed available, looking for article by randomly guessing links`);
    let guessUrl = await this.randomGuessPage(page, 20, async (page: Page) => {
      await page.evaluate(isReaderableScript);
      return page.evaluate(() => {
        // @ts-ignore
        return isProbablyReaderable(document);
      });
    });
    if (guessUrl) {
      log.verbose(`${page.url}: Guessing that this page is an article: ${guessUrl}`);
    } else {
      log.verbose(`${page.url()}: No articles found`);
    }
    return guessUrl;
  }

  async findPageWithAds(page: Page) {
    log.info(`${page.url()}: Finding random page with ads on it`);

    return this.randomGuessPage(page, 20, async (page: Page) => {
      const ads = await adDetection.identifyAdsInDOM(page)
      return ads.size > 0;
    });
  }

  async findHealthRelatedPagesWithAds(page: Page) {
    log.info(`${page.url()}: Finding random page with ads on it, prioritizing health-related pages`);
    let withAds = async (page: Page) => {
      const ads = await adDetection.identifyAdsInDOM(page)
      return ads.size > 0;
    };
    let healthKeywordsInUrl = (url: string) => {
      return HEALTH_KEYWORDS.some(keyword => url.toLowerCase().includes(keyword));
    }

    return this.randomGuessPage(page, 20, withAds, healthKeywordsInUrl)
  }
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

const HEALTH_KEYWORDS = [
  'health',
  'wellness',
  'medicine',
  'medical',
  'dental',
  'doctor',
  'dentist',
  'hospital',
  'clinic',
  'nurse',
  'pharmacy',
  'pharmaceutical',
  'prescription',
  'vaccine',
  'vaccination',
  'treatment',
  'covid',
  'coronavirus',
  'virus',
  'disease',
  'sick',
  'illn',
  'infect',
  'contagious',
  'stroke',
  'cancer',
  'dementia',
  'alzheimer',
  'diabetes',
  'tumor',
  'tumour',
  'leukemia',
  'lymphoma',
  'aids',
  'cirrhosis',
  'std',
  'wart',
  'herpes',
  'psoriasis',
  'eczema',
  'bowel',
  'syndrome',
  'ischemic',
  'arthritis',
  'hypertension'
];