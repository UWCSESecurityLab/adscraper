export default interface JobSpec {
  // Unique name for your job. If this job exists in the database, it assumes it
  // is resuming a crashed job, and will look up what has been crawled, and
  // continue from where it left off.
  jobName: string;

  // The directory on the host where screenshots, logs, and scraped content
  // should be stored. Creates or uses a directory for this job with the
  // name of the job.
  hostDataDir: string;

  // Where hostDataDir is mounted in the container. Must refer to the same
  // directory as hostDataDir on the host.
  containerDataDir: string;

  // Max number of Chromium instances to run in parallel
  maxWorkers: number;

  // (Optional) The name of a Kubernetes node that workers are restricted to.
  // If not provided, workers will be scheduled on any node with the label
  // "crawler=true".
  nodeName?: string;

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
  writeProfileAfterCrawl?: boolean;

  // Specifies whether the profile should be compressed before writing it to
  // the persistent storage location. This can reduce disk usage and
  // I/O time when storing profiles on network storage locations, at the cost of
  // CPU in the crawler container.
  compressProfileBeforeWrite?: boolean;

  // If writeProfileAfterCrawl is set to true, crawler can be set to
  // periodically save the profile during the crawl, to avoid losing progress
  // if the crawler crashes during a long crawl. This sets the frequency
  // of checkpoints, in seconds.
  profileCheckpointFreq?: number;

  // Proxy server to use for all profiles/crawls in this job (optional).
  // Launches Chrome with the provided SOCKS proxy URL.
  // Overridden if a proxy server is specified in a ProfileCrawlList.
  proxyServer?: string;

  // SSH tunnel params for all profiles/crawls in this job (optional).
  // If all three args are provided, the crawler will create an SSH tunnel
  // to the specified host and port before launching Chrome.
  // Can be useful for setting up a connection to a proxy.
  // Overridden if SSH params are specified in a ProfileCrawlList.
  // The crawler will run the following command:
  // ssh -N -D 5001 -i [sshKey] -p [sshPort] [sshHost]
  sshHost?: string;
  sshRemotePort?: number;
  // File location of the SSH private key.
  // Refers to a location within the container (typically a subdirectory of
  // containerDataDir).
  sshKey?: string;
}

interface CrawlOptions {
  shuffleCrawlList: boolean;

  // In addition to crawling the URL given, look for a link on the page
  // that leads to a page with ads, and crawl that (using the same crawl settings).
  findAndCrawlPageWithAds: number;

  // In addition to crawling the URL given, look for an article in the page's
  // RSS feed, if it has one, and crawl that (using the same crawl settings).
  // If no RSS feed exists, uses a heuristic to determine if a page is an article.
  findAndCrawlArticlePage: boolean;

  // Refresh each page after scraping it, and scrape it again.
  refreshPage: boolean;
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

// This interface specifies the configuration for individual profiles:
// which crawl lists to use, where the Chrome profile directory is located,
// and which proxy server to use.
export interface ProfileCrawlList {
  // Name/label for the crawl, used to identify this crawl in the database.
  crawlName: string;

  // ID for this profile - multiple crawls may share a profileId (e.g.
  // if the first crawl is for building a profile, the second is for scraping ads).
  profileId: string;

  // List of URLs to crawl in this profile.
  crawlListFile?: string;
  // OR, the single URL to crawl
  url?: string;

  // Location of the Chrome user-data-dir to use for this crawl.
  // If the directory doesn't exist, creates a new one at this directory,
  // called profile_<profileId>
  // Refers to a location within the container (typically a subdirectory of
  // containerDataDir).
  profileDir?: string;

  // Location the profile should be written to after the crawl,
  // if you do not want to overwrite the existing profile at
  // profileDir.
  // Refers to a location within the container (typically a subdirectory of
  // containerDataDir).
  newProfileDir?: string;

  // Proxy server to use for this profile's crawl (optional).
  // Launches Chrome with the provided SOCKS proxy URL.
  // Overrides the proxy server if specified in ProfileOptions.
  proxyServer?: string;

  // SSH tunnel params for this profile's crawl (optional).
  // If all three args are provided, the crawler will create an SSH tunnel
  // to the specified host and port before launching Chrome.
  // Overrides the SSH params if specified in ProfileOptions.
  // Can be useful for setting up SOCKS proxy servers for masking the IP.
  // The crawler will run the following command:
  // ssh -N -D 5001 -i [sshKey] -p [sshPort] [sshHost]
  sshHost?: string;
  sshRemotePort?: number;
  sshKey?: string;
}

export interface JobSpecWithProfileCrawlLists extends JobSpec {
  profileCrawlLists: ProfileCrawlList[];
}

export interface JobSpecWithCrawlList extends JobSpec {
  crawlList: string;
}

export interface JobSpecWithAdUrlCrawlList extends JobSpec {
  adUrlCrawlList: string;
}
