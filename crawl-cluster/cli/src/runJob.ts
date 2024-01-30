import k8s from '@kubernetes/client-node';
import { CrawlerFlags } from 'ads-crawler';
import amqp from 'amqplib';
import cliProgress from 'cli-progress';
import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';
import csvParser from 'csv-parser';
import fs from 'fs';
import { Validator } from 'jsonschema';
import path from 'path';
import pg from 'pg';
import * as url from 'url';
import JobSpec, { ProfileCrawlList } from './jobSpec.js';

const optionsDefinitions: commandLineUsage.OptionDefinition[] = [
  {
    name: 'help',
    alias: 'h',
    type: Boolean,
    description: 'Display this usage guide.',
    group: 'main'
  },
  {
    name: 'job',
    alias: 'j',
    type: String,
    description: 'JSON file containing the crawl job specification. See jobSpec.ts for format.',
  },
  {
    name: 'pg_conf',
    alias: 'p',
    type: String,
    description: 'JSON file containing the Postgres connection parameters: host, port, database, user, password.',
  },
  {
    name: 'amqp_broker',
    alias: 'a',
    type: String,
    description: 'Host and port of the AMQP broker.'
  }
];

const options = commandLineArgs(optionsDefinitions)._all;
const usage = commandLineUsage([
  {
    header: 'AdScraper Crawl Worker',
    content: 'Crawls pages and ads in a Puppeteer instance.'
  },
  {
    header: 'Options',
    optionList: optionsDefinitions
  }
]);

if (options.help) {
  console.log(usage);
  process.exit(0);
}

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

export function validateJobSpec(input: any) {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'jobSpecSchema.json')).toString());

  const validator = new Validator();
  const vRes = validator.validate(input, schema);

  if (vRes.valid) {
    return input as JobSpec;
  }

  throw new Error(vRes.errors.join('\n'));
}

async function main() {
  try {
    const input = JSON.parse(fs.readFileSync(options.job).toString());
    const jobSpec: JobSpec = validateJobSpec(input);
    console.log('Validated job spec');

    const pgConf = JSON.parse(fs.readFileSync(options.pg_conf).toString());
    const client = new pg.Client(pgConf);
    await client.connect();
    console.log('Connected to Postgres');

    const brokerUrl = `amqp://guest:guest@${options.amqp_broker}`;
    const amqpConn = await amqp.connect(brokerUrl);
    console.log('Connected to AMQP broker');

    // Create a job in the database
    const result = await client.query('INSERT INTO job (name, start_time, completed, job_config) VALUES ($1, $2, $3, $4) RETURNING id', [jobSpec.jobName, new Date(), false, jobSpec]);
    const jobId = result.rows[0].id;
    console.log(`Created job ${jobId} in Postgres`);

    let crawlMessages = [];

    if (jobSpec.profileCrawlLists && jobSpec.profileCrawlLists.length > 0) {
      // Create configs for individual crawls
      for (let crawl of jobSpec.profileCrawlLists) {
        let crawlSpec = crawl as ProfileCrawlList;
        // Messages to put in the queue, to be consumed by crawler. Implements
        // the CrawlerFlags interface.
        // TODO: generate crawlIds here to simplify retry handling?
        let message: CrawlerFlagsWithProfileHandling = {
          "jobId": jobId,
          "crawlName": crawlSpec.crawlName,
          "outputDir": jobSpec.dataDir,
          "urlList": crawlSpec.crawlListFile,
          "chromeOptions": {
            "profileDir": '/home/node/chrome_profile',
            "headless": 'new',
          },
          // TODO: also allow individual crawls to override crawl/scrape options if
          // we want to include different types of crawls?
          "crawlOptions": jobSpec.crawlOptions,
          "scrapeOptions": jobSpec.scrapeOptions,
          "profileOptions": {
            "useExistingProfile": jobSpec.profileOptions.useExistingProfile ? true : false,
            "writeProfile": jobSpec.profileOptions.writeProfileAfterCrawl ? true : false,
            "profileDir": crawlSpec.profileDir,
            "newProfileDir": crawlSpec.newProfileDir
          }
        };
        crawlMessages.push(message);
      }
    } else if (jobSpec.crawlList) {
      if (!fs.existsSync(jobSpec.crawlList)) {
        console.log(`${jobSpec.crawlList} does not exist.`);
        process.exit(1);
      }
      let crawlList = fs.readFileSync(jobSpec.crawlList).toString().split('\n');

      let i = 1;
      for (let url of crawlList) {
        if (!url || url.length == 0) {
          console.log(`Warning: empty line at line ${i} of ${jobSpec.crawlList}. Skipping.`);
          i++;
          continue;
        }
        let message: CrawlerFlagsWithProfileHandling = {
          "jobId": jobId,
          "outputDir": jobSpec.dataDir,
          "url": url,
          "chromeOptions": {
            "headless": 'new',
          },
          "crawlOptions": jobSpec.crawlOptions,
          "scrapeOptions": jobSpec.scrapeOptions,
          "profileOptions": {
            "useExistingProfile": false,
            "writeProfile": false
          }
        };
        crawlMessages.push(message);
        i++;
      }
    } else if (jobSpec.adUrlCrawlList) {
      let urls: string[] = [];
      let adIds: number[] = [];
      let adUrlCrawlList = jobSpec.adUrlCrawlList;
      if (!fs.existsSync(adUrlCrawlList)) {
        console.log(`${adUrlCrawlList} does not exist.`);
        process.exit(1);
      }
      await (new Promise<void>((resolve, reject) => {
        fs.createReadStream(adUrlCrawlList)
          .pipe(csvParser())
          .on('data', data => {
            urls.push(data.url);
            adIds.push(data.ad_id);
          }).on('end', () => {
            resolve();
          });
      }));
      for (let i = 0; i < urls.length; i++) {
        let message: CrawlerFlagsWithProfileHandling = {
          "jobId": jobId,
          "outputDir": jobSpec.dataDir,
          "url": urls[i],
          "adId": adIds[i],
          "chromeOptions": {
            "headless": 'new',
          },
          "crawlOptions": jobSpec.crawlOptions,
          "scrapeOptions": jobSpec.scrapeOptions,
          "profileOptions": {
            "useExistingProfile": false,
            "writeProfile": false
          },
        };
        crawlMessages.push(message);
      }
    } else {
      console.log('No crawl list provided. Must specify list in either profileCrawlLists, crawlList, or adUrlCrawlList.');
      process.exit(1);
    }

    console.log(`Generated ${crawlMessages.length} crawl messages`);

    // Programmatically create Kubernetes job
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const batchApi = kc.makeApiClient(k8s.BatchV1Api);

    let job = k8s.loadYaml(fs.readFileSync('../config/job.yaml').toString()) as k8s.V1Job;
    job.spec!.parallelism = jobSpec.maxWorkers;
    job.spec!.completions = crawlMessages.length;
    job.metadata!.name = `adscraper-job-${jobSpec.jobName.toLowerCase()}`;
    job.spec!.template.metadata!.name = `adscraper-job-${jobSpec.jobName.toLowerCase()}`;
    job.spec!.template!.spec!.containers![0].env!.push({name: 'QUEUE', value: `job${jobId}`});

    console.log('Read job YAML config');
    console.log('Running job...');
    const res = await batchApi.createNamespacedJob('default', job);
    console.log('Job sent to k8');
    console.log(res.body);

    // Fill message queue with crawl configs
    console.log('Writing crawl messages to AMQP queue');
    const QUEUE = `job${jobId}`;
    const amqpChannel = await amqpConn.createChannel();
    await amqpChannel.assertQueue(QUEUE);
    await writeToAmqpQueue(crawlMessages, amqpChannel, QUEUE);

    console.log('Done!');

    process.exit(0);
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
}

// Writes a list of crawl messages to the AMQP queue.
function writeToAmqpQueue(messages: CrawlerFlagsWithProfileHandling[], channel: amqp.Channel, queue: string) {
  const pbar = new cliProgress.SingleBar({});
  pbar.start(messages.length, 0);

  return new Promise<void>((resolve, reject) => {
    // Send a message every 1ms; back off if the queue fills up.
    async function write() {
      let ok = true;
      do {
        let message = messages.pop();
        ok = channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)));
        await sleep(1);
        pbar.increment();
      } while (ok && messages.length > 0);
      if (messages.length > 0) {
        channel.once('drain', write);
      } else {
        pbar.stop();
        resolve();
      }
    }
    write();
  });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main();

// Additional fields passed to runCrawl.sh, to specify if the profile should
// be copied into the container and/or saved after the crawl.
interface CrawlerFlagsWithProfileHandling extends CrawlerFlags {
  profileOptions: {
    useExistingProfile: boolean;
    writeProfile: boolean;
    profileDir?: string;
    newProfileDir?: string;
  }
}
