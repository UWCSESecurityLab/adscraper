import * as crawler from './crawler.js';
import pkg from 'pg';
import dotenv from "dotenv";
import {getProfile} from "./init-creds.js";
const { Client } = pkg;
import {env} from "process";

dotenv.config()

const thisProfile = await getProfile();

const pgConf = {
    host: env["POSTGRES_HOST"],
    port: 5432,
    user: 'adscraper',
    password: 'adscraper',
    database: 'adscraper'
};

let postgres = new Client(pgConf);
await postgres.connect();

const sites = [
    'https://www.huffpost.com/',
    'https://techcrunch.com/',
    'https://www.nytimes.com',
    'https://www.foxnews.com/',
    'https://www.washingtonpost.com',
    'https://yahoo.com',
    'https://www.usatoday.com',
    'https://www.cbsnews.com/'
];

// create a new job

const options = {
    max_page_crawl_depth: 1,
    inputs: sites,
    warm: false,
    shuffle: true,
    crawler_hostname: 'localhost',
    geolocation: '',
    vpn_hostname: undefined,
    job_name: `job @ ${new Date().toISOString()}`
}


const queryResult = await postgres.query(
    `INSERT INTO job (timestamp, max_page_depth, max_depth, input_files,
      warmed, shuffled, crawler_hostname, geolocation,
      vpn_hostname, name)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id;`,
    [
        new Date(),
        options.max_page_crawl_depth,
        options.max_page_crawl_depth * 2,
        options.inputs.join(', '),
        options.warm,
        options.shuffle,
        options.crawler_hostname,
        options.geolocation,
        options.vpn_hostname,
        options.job_name ? options.job_name : null
    ]);
const jobId = queryResult.rows[0].id as number;

for (let site of sites) {
    try {
        await crawler.crawl({
            clearCookiesBeforeCT: false,
            crawlArticle: true,
            crawlerHostname: options.crawler_hostname,
            crawlPageWithAds: true,
            dataset: 'test',
            disableAllCookies: false,
            disableThirdPartyCookies: false,
            jobId: jobId,
            label: 'news',
            maxPageCrawlDepth: options.max_page_crawl_depth,
            screenshotAdsWithContext: true,
            screenshotDir: './adscraper_screenshots',
            skipCrawlingSeedUrl: false,
            url: site,
            warmingCrawl: options.warm,
            updateCrawlerIpField: false
        }, postgres, thisProfile);

    } catch (e) {
        console.log(e);
    }
}
await postgres.end();
process.exit(0);
