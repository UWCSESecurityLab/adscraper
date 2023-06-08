interface JobSpec {
  // Unique name for your job. If this job exists in the database, it assumes it
  // is resuming a crashed job, and will look up what has been crawled, and
  // continue from where it left off.
  name: string;

  // Where screenshots, logs, and scraped content should be stored. Creates
  // or uses a directory for this job with the name of the job.
  dataDir: string;

  // JSON file with the Postgres connection parameters: host, port, database, user, password.
  pgConfFile: string;

  // Max number of Chromium instances to run in parallel
  numWorkers: number;

  // In isolated mode, you provide a single list of URLs, and each URL is
  // crawled in an isolated browser instance, with a clean profile.
  // In profile mode, you provide multiple lists of URLs. Each list is crawled
  // in its own Chromium profile.
  profileMode: 'isolated' | 'profile';

  // URLs to crawl in this job.
  // If |profileMode| is "isolated", provide a path to a file containing URLs,
  // one line per URL.
  // If |profileMode| is 'profiles', provide an array of ProfileCrawlListSpecs,
  // which specifies the Chromium profile name, location, and list of URLs for
  // that profile.
  crawlListSpec: string | ProfileCrawlListSpec[];

  // If true, randomizes the order of sites crawled.
  shuffle: boolean;

  // Options for what data to collect on each page.
  crawlOptions: {
    // Scrape the page content. Saves a screenshot, the HTML document, and
    // an MHTML archive.
    scrapeSite: boolean;
    // Scrape the ads on the page. Saves a screenshot of the ad and its HTML
    // content.
    scrapeAds: boolean;
    // Whether to click on the ad or not.
    // |noClick|: Do not click the ad
    // |clickAndBlockLoad|: Click the ad, but prevent it from loading.
    // This allows you to get the URL of the ad (at the beginning of the
    // redirect chain). Useful if you want to prevent the ad click from
    // influencing the browser's profile.
    // |clickAndScrapeLandingPage|: Click the ad, and scrape the content of
    // the landing page. This may affect the browsing profile.
    clickAds: 'noClick' | 'clickAndBlockLoad' | 'clickAndScrapeLandingPage';

    // TODO: capture third party network requests for tracking detection
    // captureRequests: boolean;

    // Capture third party URLs associated with ads in the DOM
    // (e.g. src attributes in the ad and its iframe, scripts that modify the ad)
    captureDOMThirdParties: boolean;

    // When scraping a screenshot of ads
    screenshotAdsWithContext?: boolean;

    // In addition to crawling the URL given, look for a link on the page
    // that leads to a page with ads, and crawl that (using the same crawl settings).
    findAndCrawlPageWithAds?: boolean;

    // In addition to crawling the URL given, look for an article in the page's
    // RSS feed, if it has one, and crawl that (using the same crawl settings).
    // If no RSS feed exists, uses a heuristic to determine if a page is an article.
    findAndCrawlArticlePage?: boolean;
  }
}


interface ProfileCrawlListSpec {
  // User provided name for the profile
  profileId: string;
  // Location of the Chrome user-data-dir to use for this crawl.
  // If empty, creates one named (TODO) at (TODO)
  profileDir: string;
  // List of URLs to crawl in this profile.
  crawlListFile: string;
}