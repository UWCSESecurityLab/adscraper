export default interface JobSpec {
  // Unique name for your job. If this job exists in the database, it assumes it
  // is resuming a crashed job, and will look up what has been crawled, and
  // continue from where it left off.
  jobName: string;

  // Where screenshots, logs, and scraped content should be stored. Creates
  // or uses a directory for this job with the name of the job.
  dataDir: string;

  // Max number of Chromium instances to run in parallel
  maxWorkers: number;

  // URLs to crawl in this job.
  // If profileOptions.profileMode is "isolated", provide a path to a file containing URLs,
  // one line per URL.
  crawlList?: string,
  // Or, if crawling ad urls, set profileOptions.profileMode to "isolated", and provide a CSV
  // with columns "ad_id" and "url"
  adUrlCrawlList?: string,
  // If profileOptions.profileMode is 'profiles', provide an array of ProfileCrawlListSpecs,
  // which specifies the Chromium profile name, location, and list of URLs for
  // that profile.
  profileCrawlLists? : ProfileCrawlList[];

  profileOptions: ProfileOptions;
  crawlOptions: CrawlOptions;
  scrapeOptions: ScrapeOptions;
}

interface ProfileOptions {
  // In "profile" mode, there are several options to specify how profiles
  // should be read, written, or updated.

  // Specifies whether crawlers should use an existing Chrome profile.
  // If true, Chrome will be launched with a copy of the userDataDir specified in
  // |crawls.profileDir| for each crawl.
  useExistingProfile?: boolean;

  // Specifies what should happen to the profile after the crawl is complete.
  // If false, the profile is deleted with the container after the crawl is
  // complete.
  // If true, the profile is writen to the directory specified in
  // |crawls.newProfileDir| if provided, or updates the existing profile in
  // |crawls.profileDir| if not.
  writeProfileAfterCrawl?: boolean
}

interface CrawlOptions   {
  shuffleCrawlList: boolean;

  // In addition to crawling the URL given, look for a link on the page
  // that leads to a page with ads, and crawl that (using the same crawl settings).
  findAndCrawlPageWithAds: boolean;

  // In addition to crawling the URL given, look for an article in the page's
  // RSS feed, if it has one, and crawl that (using the same crawl settings).
  // If no RSS feed exists, uses a heuristic to determine if a page is an article.
  findAndCrawlArticlePage: boolean;
}

interface ScrapeOptions {
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

  // Capture third party network requests for tracking detection
  captureThirdPartyRequests: boolean;

  // Capture third party URLs associated with ads in the DOM
  // (e.g. src attributes in the ad and its iframe, scripts that modify the ad)
  // captureDOMThirdParties: boolean;

  // When scraping a screenshot of ads
  screenshotAdsWithContext: boolean;
}

export interface ProfileCrawlList {
  // User provided name for the profile
  profileId: string;

  // Location of the Chrome user-data-dir to use for this crawl.
  // If the directory doesn't exist, creates a new one at this directory,
  // called profile_<profileId>
  profileDir: string;

  // Location the profile should be written to after the crawl,
  // if you do not want to overwrite the existing profile at
  // profileDir.
  newProfileDir: string;

  // List of URLs to crawl in this profile.
  crawlListFile: string;

  // Name/label for the crawl.
  crawlName: string;
}
