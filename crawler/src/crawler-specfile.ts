import * as crawler from './crawler.js';
import fs from 'fs';

const crawlSpec = JSON.parse(fs.readFileSync(process.argv[0]).toString());

// TODO: Validate crawler flags
let crawlSpecValidated = crawlSpec as crawler.CrawlerFlags;

(async function() {
  try {
    await crawler.crawl(crawlSpecValidated);
    console.log('Crawl succeeded');
    process.exit(0);
  } catch (e: any) {
    console.log(e);
    console.log('Crawl failed');
    process.exit(1);
  }
})();