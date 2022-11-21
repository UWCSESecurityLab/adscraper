import * as crawler from './crawler.js';
import pkg from 'pg';
import dotenv from "dotenv";
import {getProfile} from "./init-creds.js";
const { Client } = pkg;
import {env, exit} from "process";

dotenv.config()

const profile = env['PROFILE']

if (profile === undefined) {
    console.log("Profile is undefined!")
    exit(0)
}

const thisProfile = await getProfile(profile);

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
    'https://www.msn.com/',
    'https://www.yahoo.com/',
    'https://www.cnn.com/',
    'https://www.theguardian.com/',
    'https://www.huffingtonpost.com/',
    'https://www.foxnews.com/',
    'https://www.wsj.com/',
    'https://www.time.com/',
    'https://www.bloomberg.com/',
    'https://www.news.yahoo.com/',
    'https://www.washingtonpost.com/',
    'https://www.kompas.com/',
    'https://www.nypost.com/',
    'https://www.gizmodo.com/',
    'https://www.people.com/',
    'https://www.rt.com/',
    'https://www.politico.com/',
    'https://www.usatoday.com/',
    'https://www.forbes.com/',
    'https://www.buzzfeed.com/',
    'https://www.reuters.com/',
    'https://www.chicagotribune.com/',
    'https://www.businessinsider.com/',
    'https://www.techcrunch.com/',
    'https://www.nydailynews.com/'
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
            label: profile,
            maxPageCrawlDepth: options.max_page_crawl_depth,
            screenshotAdsWithContext: true,
            screenshotDir: `${env['SCREENSHOTS_DIR']}/${profile}`,
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
