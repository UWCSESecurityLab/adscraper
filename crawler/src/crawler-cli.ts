import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';
import fs from 'fs';
import { Client } from 'pg';
import os from 'os';
import * as crawler from './crawler.js';
import * as log from './log.js';

const optionsDefinitions: commandLineUsage.OptionDefinition[] = [
  {
    name: 'help',
    alias: 'h',
    type: Boolean,
    description: 'Display this usage guide.',
    group: 'main'
  },
  {
    name: 'job_id',
    alias: 'j',
    type: Number,
    description: 'ID of the job that is managing this crawl.',
    group: 'main'
  },
  {
    name: 'max_page_crawl_depth',
    alias: 'd',
    type: Number,
    description: `The maximum depth of pages to crawl. Default = 2`,
    group: 'main'
  },
  {
    name: 'url',
    type: String,
    description: 'The target URL to crawl.',
    group: 'main'
  },
  {
    name: 'dataset',
    type: String,
    description: 'The filename of the dataset the target URL originated from. Default = \'Test\'',
    group: 'main'
  },
  {
    name: 'screenshot_dir',
    type: String,
    description: 'Directory where screenshot files should be saved.',
    group: 'main'
  },
  {
    name: 'external_screenshot_dir',
    type: String,
    description: 'If this crawler is being run inside a Docker container, the directory on the Docker host where the screenshot files are actually saved (in this case, --screenshot_dir should refer to the directory inside the container). (Optional)',
    group: 'main'
  },
  {
    name: 'crawler_hostname',
    type: String,
    description: 'The hostname of this crawler. Defaults to "os.hostname()", but if this crawler is being run in a Docker container, you must manually supply the hostname of the Docker host to correctly tag screenshots.',
    defaultValue: os.hostname(),
    group: 'main'
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
    name: 'label',
    type: String,
    description: 'User-supplied label for the input website, e.g. tags for categories of websites. (Optional)',
    group: 'main'
  },
  {
    name: 'crawl_article',
    alias: 'a',
    type: Boolean,
    description: 'Crawl in article mode: in addition to crawling the home page, crawl the first article in the site\'s RSS feed.',
    group: 'options'
  },
  {
    name: 'crawl_page_with_ads',
    type: Boolean,
    description: 'Crawl page with ads: in addition to crawling the home page, crawl a page on this domain that has ads.',
    group: 'options'
  },
  {
    name: 'warming_crawl',
    alias: 'w',
    type: Boolean,
    description: 'Crawl in warming mode: reduced sleep and timeouts, skip data collection',
    group: 'options'
  },
  {
    name: 'disable_all_cookies',
    type: Boolean,
    description: 'Disable all cookies in the browser',
    group: 'options'
  },
  {
    name: 'disable_third_party_cookies',
    type: Boolean,
    description: 'Disable third party cookies and document.cookie',
    group: 'options'
  },
  {
    name: 'clear_cookies_before_ct',
    type: Boolean,
    description: 'Clear browser cookies before clicking ads',
    group: 'options'
  },
  {
    name: 'skip_crawling_seed_url',
    type: Boolean,
    description: 'Skip crawling the seed_url page, and any ads on it. Will still crawl articles if -a is passed.',
    group: 'options'
  },
  {
    name: 'screenshot_ads_with_context',
    type: Boolean,
    description: 'When screenshotting ads, include a margin around the ad to provide page context',
    defaultValue: false,
    group: 'options'
  },
  {
    name: 'update_crawler_ip_field',
    type: Boolean,
    description: 'Update the crawler_ip field in the job table (use this flag on the first crawler when performing a crawl using the dockerized VPN).',
    defaultValue: false,
    group: 'options'
  }
];

const options = commandLineArgs(optionsDefinitions)._all;
const usage = [
  {
    header: 'AdScraper Crawl Worker',
    content: 'Crawls pages and ads in a puppeteer instance.'
  },
  {
    header: 'Crawler Configuration',
    group: 'main',
    optionList: optionsDefinitions
  },
  {
    header: 'Database Configuration',
    optionList: optionsDefinitions,
    group: 'pg'
  },
  {
    header: 'Crawl Options',
    group: 'options',
    optionList: optionsDefinitions
  }
];

if (options.help) {
  console.log(commandLineUsage(usage));
  process.exit(0);
}
if (!options.url) {
  console.log('Missing required parameter: --url');
  console.log('Run "node gen/crawler-cli.js --help" to view usage guide');
  process.exit(1);
}
if (!options.job_id) {
  console.log('Missing required parameter: --job_id');
  console.log('Run "node gen/crawler-cli.js --help" to view usage guide');
  process.exit(1);
}
if (!options.screenshot_dir) {
  console.log('Missing required parameter: --screenshot_dir');
  console.log('Run "node gen/crawler-cli.js --help" to view usage guide');
  process.exit(1);
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
  // Initialize Postgres client
  let postgres = new Client(pgConf);
  await postgres.connect();
  log.info('Postgres driver initialized');

  try {
    await crawler.crawl({
      clearCookiesBeforeCT: options.clear_cookies_before_ct ? true : false,
      crawlArticle: options.crawl_article ? true : false,
      crawlerHostname: options.crawler_hostname,
      crawlPageWithAds: options.crawl_page_with_ads ? true : false,
      dataset: options.dataset ? options.dataset : 'test',
      disableAllCookies: options.disable_all_cookies ? true : false,
      disableThirdPartyCookies: options.disable_third_party_cookies ? true : false,
      jobId: options.job_id as number,
      label: options.label,
      maxPageCrawlDepth: options.max_page_crawl_depth !== undefined ? options.max_page_crawl_depth as number : 2,
      screenshotAdsWithContext: options.screenshot_ads_with_context as boolean,
      screenshotDir: options.screenshot_dir as string,
      externalScreenshotDir: options.external_screenshot_dir as string | undefined,
      skipCrawlingSeedUrl: options.skip_crawling_seed_url ? true : false,
      url: options.url as string,
      warmingCrawl: options.warming_crawl ? true : false,
      updateCrawlerIpField: options.update_crawler_ip_field as boolean
    }, postgres, null);
    await postgres.end();
    process.exit(0);
  } catch (e) {
    await postgres.end();
    process.exit(1);
  }
})();