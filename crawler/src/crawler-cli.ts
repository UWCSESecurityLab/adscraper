import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';
import fs from 'fs';
import os from 'os';
import sourceMapSupport from 'source-map-support';
import * as crawler from './crawler.js';
import { LogLevel } from './util/log.js';

console.log(process.argv);

sourceMapSupport.install();

const optionsDefinitions: commandLineUsage.OptionDefinition[] = [
  {
    name: 'help',
    alias: 'h',
    type: Boolean,
    description: 'Display this usage guide.',
    group: 'main'
  },
  {
    name: 'output_dir',
    type: String,
    description: 'Directory where screenshot, HTML, and MHTML files will be saved.',
    group: 'main'
  },
  {
    name: 'name',
    type: String,
    description: 'Name of this crawl (optional).',
    group: 'main',
  },
  // {
  //   name: 'crawl_id',
  //   type: Number,
  //   description: 'If resuming a previous crawl, the id of the previous crawl (Optional).',
  //   group: 'main'
  // },
  {
    name: 'job_id',
    alias: 'j',
    type: Number,
    description: 'ID of the job that is managing this crawl (Optional, required if run via Kubernetes job)',
    group: 'main'
  },
  {
    name: 'resume_if_able',
    type: Boolean,
    defaultOption: false,
    description: 'If included, the crawler will attempt to resume any previous incomplete crawl with the same name, if one exists. Otherwise, a new crawl record is created and this has no effect.'
  },
  {
    name: 'log_level',
    type: String,
    description: 'Sets the level of logging verbosity. Choose one of the following: error > warning > info > debug > verbose. Defaults to "info"',
    defaultValue: 'info',
    group: 'main'
  },
  {
    name: 'crawl_list',
    type: String,
    description: 'A text file containing URLs to crawl, one URL per line',
    group: 'input'
  },
  {
    name: 'ad_url_crawl_list',
    type: String,
    description: 'A CSV with the columns (url, ad_id) containing URLs to crawl, and the ad_id of the referrer ad. Use this option instead of --crawl_list if scraping ad landing pages separately from ads, to avoid profile pollution.',
    group: 'input'
  },
  {
    name: 'url',
    type: String,
    description: 'A single URL to crawl. Use this option instead of --crawl_list to crawl one URL at a time.',
    group: 'input'
  },
  {
    name: 'ad_id',
    type: String,
    description: 'If scraping a single URL with --url that is an ad landing page, use this flag to specify the ad in the database that the landing page is associated with.',
    group: 'input',
  },
  {
    name: 'pg_conf_file',
    type: String,
    description: 'JSON file with the Postgres connection parameters: host, port, database, user, password. If no file is supplied, these can also be passed in the below command line flags.',
    group: 'pg'
  },
  {
    name: 'pg_host',
    type: String,
    description: 'Hostname of the postgres instance to connect to. (Default: localhost)',
    defaultValue: 'localhost',
    group: 'pg'
  },
  {
    name: 'pg_port',
    type: Number,
    description: 'Port of the postgres instance to connect to. (Default: 5432) ',
    defaultValue: 5432,
    group: 'pg'
  },
  {
    name: 'pg_database',
    type: String,
    description: 'Name of postgres database. (Default: adscraper)',
    defaultValue: 'adscraper',
    group: 'pg'
  },
  {
    name: 'pg_user',
    type: String,
    description: 'Name of postgres user',
    group: 'pg'
  },
  {
    name: 'pg_password',
    type: String,
    description: 'Password for postgres user',
    group: 'pg'
  },
  {
    name: 'headless',
    type: String,
    description: 'Which Puppeteer headless mode the crawler should run in. Either "true", "false", or "shell" (default: "true")',
    defaultValue: "true",
    group: 'chromeOptions',
  },
  {
    name: 'profile_dir',
    type: String,
    description: 'Directory of the profile (user data directory) that Puppeteer should use for this crawl (Optional). Provide this if you want a profile that can be reused between crawls. If not provided (for stateless crawls), uses a new, empty profile.',
    group: 'chromeOptions'
  },
  {
    name: 'executable_path',
    type: String,
    description: 'Path to the Chrome executable to use for this crawl (Optional). If not provided, uses the default Puppeteer executable.',
    group: 'chromeOptions'
  },
  {
    name: 'proxy_server',
    type: String,
    description: 'Proxy server that all Chrome traffic should pass through (Optional). This value is passed directly to Chrome\'s --proxy_server flag.',
    group: 'chromeOptions'
  },
  {
    name: 'shuffle_crawl_list',
    type: Boolean,
    description: 'Include this arg to randomize the order the URLs in the crawl list are visited.',
    group: 'crawlOptions',
  },
  {
    name: 'crawl_article',
    type: Boolean,
    description: 'Crawl in article mode: if included, in addition to crawling the home page, crawl the first article in the site\'s RSS feed.',
    group: 'crawlOptions'
  },
  {
    name: 'crawl_page_with_ads',
    type: Number,
    defaultValue: 0,
    description: 'Crawl pages with ads: if included, on addition to crawling the URLs from the crawl list, the crawler will crawl additional links on the page with ads. Pass the number of additional pages you want to visit.',
    group: 'crawlOptions'
  },
  {
    name: 'refresh_pages',
    type: Boolean,
    defaultValue: false,
    description: 'If included, the crawler will refresh each page after each scrape, and scrape the page a second time. Default: false',
    group: 'crawlOptions'
  },
  {
    name: 'scrape_site',
    type: Boolean,
    description: 'If included, the crawler will scrape the content of the sites in the crawl list.',
    group: 'scrapeOptions'
  },
  {
    name: 'scrape_ads',
    type: Boolean,
    description: 'If included, the crawler will scrape the content of ads on the sites in the crawl list.',
    group: 'scrapeOptions'
  },
  {
    name: 'capture_third_party_request_urls',
    type: Boolean,
    description: 'If included, the crawler will capture the URLs of any third-party requests made by websites (can be used for measuring tracking in conjunction with a tracker URL list).',
    group: 'scrapeOptions'
  },
  {
    name: 'click_ads',
    type: String,
    description: 'Specify whether to click on ads. Must be one of: noClick, clickAndBlockLoad, or clickAndScrapeLandingPage. If noClick, no ads will be clicked. If "clickAndBlockLoad", the ads will be clicked, but prevented from loading, and the initial URL of the ad will be stored in the database. If "clickAdAndScrapeLandingPage", ads will be clicked, and the landing page content will be scraped. The --scrape_ads arg must also be used. Default: "noClick"',
    defaultValue: 'noClick',
    group: 'scrapeOptions'
  },
  {
    name: 'screenshot_ads_with_context',
    type: Boolean,
    description: 'If included, when screenshotting ads, includes a 150px margin around the ad to provide context of where it is on the page.',
    defaultValue: false,
    group: 'scrapeOptions'
  }
];

const options = commandLineArgs(optionsDefinitions)._all;
const usage = [
  {
    header: 'AdScraper Crawl Worker',
    content: 'Crawls pages and ads in a Puppeteer instance.'
  },
  {
    header: 'Main Options',
    group: 'main',
    optionList: optionsDefinitions
  },
  {
    header: 'Input Options (Choose one)',
    group: 'input',
    optionList: optionsDefinitions,
  },
  {
    header: 'Database Configuration',
    optionList: optionsDefinitions,
    group: 'pg'
  },{
    header: 'Puppeteer Options',
    optionList: optionsDefinitions,
    group: 'chromeOptions'
  },
  {
    header: 'Crawl Options',
    group: 'crawlOptions',
    optionList: optionsDefinitions
  },
  {
    header: 'Scrape Options',
    group: 'scrapeOptions',
    optionList: optionsDefinitions
  }
];

if (options.help) {
  console.log(commandLineUsage(usage));
  process.exit(0);
}

if ((!!options.crawl_list ? 1 : 0) + (!!options.ad_url_crawl_list ? 1 : 0) + (!!options.url ? 1 : 0) != 1) {
  console.log('Must specify input using exactly one of --crawl_list, --ad_url_crawl_list, or --url');
  console.log('Run "node gen/crawler-cli.js --help" to view usage guide');
  process.exit(1);
}

if (!options.output_dir) {
  console.log('Missing required parameter: --output_dir');
  console.log('Run "node gen/crawler-cli.js --help" to view usage guide');
  process.exit(1);
}
if (options.click_ads !== 'noClick' && options.click_ads !== 'clickAndBlockLoad' && options.click_ads !== 'clickAndScrapeLandingPage') {
  console.log('--clickAds must be one of "noClick", "clickAndBlockLoad", or "clickAndScrapeLandingPage"');
  console.log('Run "node gen/crawler-cli.js --help" to view usage guide');
  process.exit(1);
}

let headless: boolean;
if (options.headless == 'true') {
  headless = true;
} else if (options.headless == 'false') {
  headless = false;
} else {
  console.log('Value of --headless must be either "true" or "false"');
  console.log('Run "node gen/crawler-cli.js --help" to view usage guide');
  process.exit(1);
}

let logLevel: LogLevel;
switch (options.log_level) {
  case 'error':
    logLevel = LogLevel.ERROR
    break;
  case 'warning':
    logLevel = LogLevel.WARNING
    break;
  case 'info':
    logLevel = LogLevel.INFO
    break;
  case 'debug':
    logLevel = LogLevel.DEBUG
    break;
  case 'verbose':
    logLevel = LogLevel.VERBOSE
    break;
  default:
    console.log(`Invalid log level: ${options.log_level}`)
    console.log('Run "node gen/crawler-cli.js --help" to view usage guide');
    process.exit(1)
}

let pgConf: {
  host: string,
  port: number,
  user: string,
  password: string,
  database: string
};

if (options.pg_conf_file && fs.existsSync(options.pg_conf_file)) {
  pgConf = JSON.parse(fs.readFileSync(options.pg_conf_file).toString());
} else {
  pgConf = {
    host: options.pg_host,
    port: options.pg_port,
    user: options.pg_user,
    password: options.pg_password,
    database: options.pg_database
  }
}

(async function() {
  try {
    await crawler.crawl({
      jobId: options.job_id,
      // crawlId: options.crawl_id,
      crawlName: options.name,
      resumeIfAble: options.resume_if_able,
      outputDir: options.output_dir,
      url: options.url,
      adId: options.ad_id,
      urlList: options.crawl_list,
      adUrlList: options.ad_url_crawl_list,
      logLevel: logLevel,

      chromeOptions: {
        headless: headless,
        profileDir: options.profile_dir,
        executablePath: options.executable_path,
        proxyServer: options.proxy_server
      },

      crawlOptions: {
        shuffleCrawlList: Boolean(options.shuffleCrawlList),
        findAndCrawlArticlePage: Boolean(options.crawl_article),
        findAndCrawlPageWithAds: options.crawl_page_with_ads,
        refreshPage: options.refresh_pages,
      },

      scrapeOptions: {
        scrapeSite: Boolean(options.scrape_site),
        scrapeAds: Boolean(options.scrape_ads),
        clickAds: options.click_ads,
        screenshotAdsWithContext: Boolean(options.screenshot_ads_with_context),
        captureThirdPartyRequests: Boolean(options.capture_third_party_request_urls)
      },
    }, pgConf);
    console.log('Crawl succeeded');
    process.exit(0);
  } catch (e: any) {
    console.log(e);
    console.log('Crawl failed');
    process.exit(1);
  }
})();