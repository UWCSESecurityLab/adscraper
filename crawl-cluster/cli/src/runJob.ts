import k8s from '@kubernetes/client-node';
import { CrawlerFlags } from 'ads-crawler';
import amqp from 'amqplib';
import fs from 'fs';
import { Validator } from 'jsonschema';
import path from 'path';
import pg from 'pg';
import * as url from 'url';
import JobSpec, { ProfileCrawlList } from './jobSpec.js';
import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';

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

    if (jobSpec.profileOptions.profileMode == 'profile') {
      // Create configs for individual crawls
      for (let crawl of jobSpec.crawls) {
        let crawlSpec = crawl as ProfileCrawlList;
        // Messages to put in the queue, to be consumed by crawler. Implements
        // the CrawlerFlags interface.
        // TODO: generate crawlIds here to simplify retry handling?
        let message: CrawlerFlagsWithProfileHandling = {
          "jobId": jobId,
          "crawlName": crawlSpec.crawlName,
          "outputDir": jobSpec.dataDir,
          "crawlListFile": crawlSpec.crawlListFile,
          "crawlListHasReferrerAds": crawlSpec.crawlListHasReferrerAds,
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
    } else if (jobSpec.profileOptions.profileMode == 'isolated') {
      let crawlListFile = jobSpec.crawls as string;
      let crawlList = fs.readFileSync(crawlListFile).toString().split('\n');
      for (let url of crawlList) {
        let message: CrawlerFlagsWithProfileHandling = {
          "jobId": jobId,
          "outputDir": jobSpec.dataDir,
          "url": url,
          "crawlListHasReferrerAds": false,
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
      }
    }

    console.log(`Generated ${crawlMessages.length} crawl messages`);

    // Fill message queue with crawl configs
    const QUEUE = `job${jobId}`;
    const amqpChannel = await amqpConn.createChannel();
    await amqpChannel.assertQueue(QUEUE);
    for (let message of crawlMessages) {
      console.log(`Sending message to queue ${QUEUE}`);
      amqpChannel.sendToQueue(QUEUE, Buffer.from(JSON.stringify(message)));
    }
    console.log(`${crawlMessages.length} crawl messages sent to queue ${QUEUE}`);

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
    console.log('Job sent to k8s successfully');
    console.log(res.body);
    process.exit(0);
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
}

main();


interface CrawlerFlagsWithProfileHandling extends CrawlerFlags {
  profileOptions: {
    useExistingProfile: boolean;
    writeProfile: boolean;
    profileDir?: string;
    newProfileDir?: string;
  }
}
