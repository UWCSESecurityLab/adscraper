import k8s from '@kubernetes/client-node';
import amqp from 'amqplib';
import fs from 'fs';
import pg, { ClientConfig } from 'pg';
import { Validator } from 'jsonschema';
import path from 'path';
import { CrawlerFlags } from 'ads-crawler';
import JobSpec from './jobSpec.js';

console.log(process.env);

let pgConf: ClientConfig = {
  host: '127.0.0.1',
  port: 5432,
  user: 'adscraper',
  password: 'insert_password_here',
  database: 'adscraper'
}

// Minikube: replace URL (after @) with IP and port provided by
// minikube service rabbitmq-service --url
const BROKER_URL = 'amqp://guest:guest@127.0.0.1:62161';
const QUEUE = 'job1';

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
    console.log(jobSpec);

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
    console.log(`Generated ${crawlMessages.length} crawl nessages`);

    // Fill message queue with crawl configs
    const amqpConn = await amqp.connect(BROKER_URL);
    console.log('connected to amqp broker');
    const amqpChannel = await amqpConn.createChannel();
    await amqpChannel.assertQueue(QUEUE);
    for (let message of crawlMessages) {
      console.log('Sending message');
      amqpChannel.sendToQueue(QUEUE, Buffer.from(JSON.stringify(message)));
    }

    console.log('Crawl messages sent to message queue');

    // Programmatically create Kubernetes job
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const batchApi = kc.makeApiClient(k8s.BatchV1Api);

    let job = k8s.loadYaml(fs.readFileSync('../config/job.yaml').toString()) as k8s.V1Job;
    job.spec!.parallelism = jobSpec.maxWorkers;
    job.spec!.completions = crawlMessages.length;

    // .metadata.name = job-${job.jobName}
    // .template.metadata.name = crawl-${job.jobName}

    console.log('Read job YAML config');
    console.log('Running job...');
    await batchApi.createNamespacedJob('default', job);
    console.log('Job sent to k8s successfully');
  } catch (e) {
    console.log(e);
  }
}

main();
