import * as crawler from './crawler.js';
import fs from 'fs';
import { Validator } from 'jsonschema';
import path from 'path';
import * as url from 'url';
import os from 'os';

console.log(os.userInfo());

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

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
  console.log(input);
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'crawlerFlagsSchema.json')).toString());
  const validator = new Validator();
  const vRes = validator.validate(input, schema);

  if (vRes.valid) {
    return input as crawler.CrawlerFlags;
  }
  console.log('Input did not validate');
  throw new Error(vRes.errors.join('\n'));
}

async function main(flags: crawler.CrawlerFlags) {
  try {
    // console.log(fs.lstatSync('/run/dbus/system_bus_socket'));
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