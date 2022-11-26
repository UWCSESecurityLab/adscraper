import * as crawler from './crawler.js';
import pkg from 'pg';
import dotenv from "dotenv";
import {getProfile} from "./init-creds.js";
const { Client } = pkg;
import {env, exit} from "process";
import _ from "lodash";
import * as log from "./log.js";
import {addExtra} from "puppeteer-extra";
import puppeteer from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import rimraf from "rimraf";
import path from "path";

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

// Open browser
log.info('Launching browser...');
const extraPuppeteer = addExtra(puppeteer);
const stealthPlugin = StealthPlugin();
stealthPlugin.enabledEvasions.delete('iframe.contentWindow');
stealthPlugin.enabledEvasions.delete('navigator.plugins');
extraPuppeteer.use(stealthPlugin);
const profileStr = env['PROFILE'];

const profileDirectory = env['PROFILE_DIR'] ? `${env['PROFILE_DIR']}/${profileStr}` : `user-data/${profileStr}`;

// Cleanup cache in profile data
rimraf.sync(path.join(profileDirectory, 'DevToolsActivePort'));
rimraf.sync(path.join(profileDirectory, 'Default', 'Cache'));
rimraf.sync(path.join(profileDirectory, 'Default', 'Code Cache'));
rimraf.sync(path.join(profileDirectory, 'Default', 'DawnCache'));

for (let site of _.shuffle(sites)) {
    try {
        await crawler.crawl(profileDirectory, extraPuppeteer, {
            clearCookiesBeforeCT: false,
            crawlArticle: false,
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
