import * as crawler from './crawler.js';
import fs from 'fs';
import { Validator } from 'jsonschema';

process.stdin.once('data', async (data) => {
  try {
    const flags = validateCrawlSpec(JSON.parse(data.toString()));
    await main(flags);
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
});

function validateCrawlSpec(input: any) {
  const schema = JSON.parse(fs.readFileSync('crawlerFlagsSchema.json').toString());

  const validator = new Validator();
  const vRes = validator.validate(input, schema);

  if (vRes.valid) {
    return input as crawler.CrawlerFlags;
  }

  throw new Error(vRes.errors.join('\n'));
}

async function main(flags: crawler.CrawlerFlags) {
  try {
    await crawler.crawl(flags, {
      host: process.env.PG_HOST,
      port: parseInt(process.env.PG_PORT!),
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE
    });
    console.log('Crawl succeeded');
    process.exit(0);
  } catch (e: any) {
    console.log(e);
    console.log('Crawl failed');
    process.exit(1);
  }
}