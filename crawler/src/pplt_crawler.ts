import * as crawler from './crawler.js';
import pkg from 'pg';
const { Client } = pkg;

let postgres = new Client({
    "host": "localhost",
    "port": 5432,
    "database": "adscraper",
    "user": "adscraper",
    "password": "adscraper"
});
await postgres.connect();

const sites = [
    'https://www.nytimes.com',
    'https://www.washingtonpost.com',
    'https://yahoo.com',
    'https://www.usatoday.com'
];

for (let site of sites) {
    try {
        await crawler.crawl({
            clearCookiesBeforeCT: false,
            crawlArticle: true,
            crawlerHostname: 'localhost',
            crawlPageWithAds: false,
            dataset: 'test',
            disableAllCookies: false,
            disableThirdPartyCookies: false,
            jobId: 1,
            label: 'news',
            maxPageCrawlDepth: 2,
            screenshotAdsWithContext: true,
            screenshotDir: './adscraper_screenshots',
            skipCrawlingSeedUrl: false,
            url: site,
            warmingCrawl: false,
            updateCrawlerIpField: false
        }, postgres);

    } catch (e) {
        console.log(e);
    }
}
await postgres.end();
process.exit(0);
