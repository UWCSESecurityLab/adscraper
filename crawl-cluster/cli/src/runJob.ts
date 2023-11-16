import k8s from '@kubernetes/client-node';
import { CrawlerFlags } from 'ads-crawler';
import amqp from 'amqplib';
import fs from 'fs';
import { Validator } from 'jsonschema';
import path from 'path';
import pg, { ClientConfig } from 'pg';
import * as url from 'url';
import JobSpec from './jobSpec.js';

let pgConf: ClientConfig = {
  host: '127.0.0.1',
  port: 5432,
  user: 'adscraper',
  password: 'insert_password_here',
  database: 'adscraper'
}

// Minikube: replace URL (after @) with IP and port provided by
// minikube service rabbitmq-service --url
const BROKER_URL = 'amqp://guest:guest@127.0.0.1:55425';
// const QUEUE = 'job1';
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
    let input = JSON.parse(fs.readFileSync(process.argv[2]).toString());
    const jobSpec: JobSpec = validateJobSpec(input);

    console.log('Read valid job spec');
    // console.log(jobSpec);

    // Create a job in the database
    const client = new pg.Client(pgConf);
    await client.connect();
    const result = await client.query('INSERT INTO job (name, start_time, completed, job_config) VALUES ($1, $2, $3, $4) RETURNING id', [jobSpec.jobName, new Date(), false, jobSpec]);
    const jobId = result.rows[0].id;
    // const jobId = 1;

    console.log(`Created job ${jobId} in postgres`);

    // Create configs for individual crawls
    let crawlMessages = [];
    for (let crawlSpec of jobSpec.crawls) {
      // Messages to put in the queue, to be consumed by crawler. Implements
      // the CrawlerFlags interface.
      // TODO: generate crawlIds here to simplify retry handling?
      let message: CrawlerFlags = {
        "jobId": jobId,
        "crawlName": crawlSpec.crawlName,
        "outputDir": jobSpec.dataDir,
        "crawlListFile": crawlSpec.crawlListFile,
        "crawlListHasReferrerAds": crawlSpec.crawlListHasReferrerAds,
        "chromeOptions": {
          "profileDir": crawlSpec.profileDir,
          "headless": 'new',
        },
        // TODO: also allow individual crawls to override crawl/scrape options if
        // we want to include different types of crawls?
        "crawlOptions": jobSpec.crawlOptions,
        "scrapeOptions": jobSpec.scrapeOptions
      };

      crawlMessages.push(message);
    }
    console.log(`Generated ${crawlMessages.length} crawl messages`);

    // Fill message queue with crawl configs
    const QUEUE = `job${jobId}`;
    const amqpConn = await amqp.connect(BROKER_URL);
    console.log('Connected to AMQP broker');
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
    console.log(res);
    process.exit(0);
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
}

main();
