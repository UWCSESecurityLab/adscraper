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
import JobSpec, { JobSpecWithAdUrlCrawlList, JobSpecWithCrawlList, JobSpecWithProfileCrawlLists, ProfileCrawlList } from './jobSpec.js';

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
    name: 'resume',
    type: Boolean,
    description: 'Include this flag to resume an existing job. The job name in the job specification must match the name of an existing job in the database. The job runner will automatically configure the job to complete the remaining crawls in the previously stopped job\'s message queue.'
  },
  {
    name: 'pg_conf',
    alias: 'p',
    type: String,
    description: 'JSON file containing the Postgres connection parameters: host, port, database, user, password.',
  },
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

let client: pg.Client;

async function main() {
  try {
    // Validate input
    const input = JSON.parse(fs.readFileSync(options.job).toString());
    const jobSpec: JobSpec = validateJobSpec(input);
    console.log('Validated job spec');

    // Connect to postgres database
    const pgConf = JSON.parse(fs.readFileSync(options.pg_conf).toString());
    client = new pg.Client(pgConf);
    await client.connect();
    console.log('Connected to Postgres');

    // Connect to k8s cluster
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const batchApi = kc.makeApiClient(k8s.BatchV1Api);
    console.log('Connected to K8s API');

    if (!options.resume) {
      // Create a job in the database
      const result = await client.query('INSERT INTO job (name, start_time, completed, job_config) VALUES ($1, $2, $3, $4) RETURNING id', [jobSpec.jobName, new Date(), false, jobSpec]);
      const jobId = result.rows[0].id;
      console.log(`Created job ${jobId} in Postgres`);

      const crawlInputDir = path.join(jobSpec.hostDataDir, `job_${jobId}/crawl_inputs`);
      fs.mkdirSync(crawlInputDir, { recursive: true });

      // Generate crawl inputs and job YAML
      let crawlInputs = await generateCrawlMessages(jobId, jobSpec);
      for (let i = 0; i < crawlInputs.length; i++) {
        fs.writeFileSync(path.join(crawlInputDir, `crawl_input_${i}.json`), JSON.stringify(crawlInputs[i]));
      }

      let job = await generateK8sJob({
        parallelism: jobSpec.maxWorkers,
        completions: crawlInputs.length,
        jobId: jobId,
        jobName: jobSpec.jobName,
        nodeName: jobSpec.nodeName
      });

      // Submit the job to cluster
      console.log('Submitting k8s job');
      const res = await batchApi.createNamespacedJob('default', job);
      console.log(res.body);
    }

    console.log('Done!');
    process.exit(0);
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
}

async function generateK8sJob(options: {parallelism: number, completions: number, jobId: number, jobName: string, nodeName?: string}) {
  let job = k8s.loadYaml(fs.readFileSync('../config/indexed-job.yaml').toString()) as k8s.V1Job;
  job.spec!.parallelism = options.parallelism;
  job.spec!.completions = options.completions;
  job.metadata!.name = `${options.jobName.toLowerCase()}`;
  job.metadata!.labels!.jobgroup = `${options.jobName.toLowerCase()}`;
  job.spec!.template.metadata!.name = `${options.jobName.toLowerCase()}`;
  job.spec!.template.metadata!.labels!.jobgroup = `${options.jobName.toLowerCase()}`;
  job.spec!.template!.spec!.containers![0].env!.push({name: 'JOB_ID', value: options.jobId.toString()});
  if (options.nodeName) {
    job.spec!.template!.spec!.nodeName = options.nodeName;
  }
  return job;
}

async function generateCrawlMessages(jobId: number, jobSpec: JobSpec): Promise<CrawlerFlagsWithProfileHandling[]> {
  let crawlMessages = [];
  if (jobSpec.profileCrawlLists && jobSpec.profileCrawlLists.length > 0) {
    // Create configs for individual crawls
    crawlMessages = generateProfileCrawlMessages(jobId, jobSpec as JobSpecWithProfileCrawlLists);
  } else if (jobSpec.crawlList) {
    crawlMessages = generateIsolatedCrawlMessages(jobId, jobSpec as JobSpecWithCrawlList);
  } else if (jobSpec.adUrlCrawlList) {
    crawlMessages = await generateAdCrawlMessages(jobId, jobSpec as JobSpecWithAdUrlCrawlList);
  } else {
    console.log('No crawl list provided. Must specify list in either profileCrawlLists, crawlList, or adUrlCrawlList.');
    process.exit(1);
  }
  console.log(`Generated ${crawlMessages.length} crawl messages`);
  return crawlMessages;
}

function generateProfileCrawlMessages(jobId: number, jobSpec: JobSpecWithProfileCrawlLists) {
  let crawlMessages = [];
  for (let crawl of jobSpec.profileCrawlLists) {
    let crawlSpec = crawl as ProfileCrawlList;
    // Messages to put in the queue, to be consumed by crawler. Implements
    // the CrawlerFlags interface.
    let message: CrawlerFlagsWithProfileHandling = {
      "jobId": jobId,
      "crawlName": crawlSpec.crawlName,
      "resumeIfAble": true,
      "outputDir": jobSpec.containerDataDir,
      // "urlList": crawlSpec.crawlListFile,
      "profileId": crawlSpec.profileId,
      "chromeOptions": {
        "profileDir": '/home/pptruser/chrome_profile',
        "headless": true,
        "proxyServer": crawlSpec.proxyServer ? crawlSpec.proxyServer : jobSpec.profileOptions.proxyServer,
      },
      // TODO: also allow individual crawls to override crawl/scrape options if
      // we want to include different types of crawls?
      "crawlOptions": jobSpec.crawlOptions,
      "scrapeOptions": jobSpec.scrapeOptions,
      "profileOptions": {
        "useExistingProfile": jobSpec.profileOptions.useExistingProfile && crawlSpec.profileDir ? true : false,
        "writeProfile": jobSpec.profileOptions.writeProfileAfterCrawl && (crawlSpec.profileDir || crawlSpec.newProfileDir) ? true : false,
        "profileDir": crawlSpec.profileDir,
        "newProfileDir": crawlSpec.newProfileDir,
        "sshKey": crawlSpec.sshKey ? crawlSpec.sshKey : jobSpec.profileOptions.sshKey,
        "sshHost": crawlSpec.sshHost ? crawlSpec.sshHost : jobSpec.profileOptions.sshHost,
        "sshRemotePort": crawlSpec.sshRemotePort ? crawlSpec.sshRemotePort : jobSpec.profileOptions.sshRemotePort
      }
    };
    if (crawlSpec.crawlListFile) {
      message.urlList = crawlSpec.crawlListFile;
    } else if (crawlSpec.url) {
      message.url = crawlSpec.url;
    } else {
      console.log(`Error: No crawl list file or crawl URL provided for profile ${crawlSpec.crawlName}.`);
      process.exit(1);
    }
    crawlMessages.push(message);
  }
  return crawlMessages;
}

function generateIsolatedCrawlMessages(jobId: number, jobSpec: JobSpecWithCrawlList) {
  let crawlMessages = [];
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
      "crawlName": `${jobSpec.jobName}_url_${i}`,
      "outputDir": jobSpec.containerDataDir,
      "resumeIfAble": true,
      "url": url,
      "chromeOptions": {
        "headless": true,
        "proxyServer": jobSpec.profileOptions.proxyServer
      },
      "crawlOptions": jobSpec.crawlOptions,
      "scrapeOptions": jobSpec.scrapeOptions,
      "profileOptions": {
        "useExistingProfile": false,
        "writeProfile": false,
        "sshHost": jobSpec.profileOptions.sshHost,
        "sshRemotePort": jobSpec.profileOptions.sshRemotePort,
        "sshKey": jobSpec.profileOptions.sshKey
      }
    };
    crawlMessages.push(message);
    i++;
  }
  return crawlMessages;
}

async function generateAdCrawlMessages(jobId: number, jobSpec: JobSpecWithAdUrlCrawlList) {
  let crawlMessages = [];
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
        if (!data.ad_id) {
          reject(new Error('ad_id column missing from adUrlCrawlList'));
        }
        if (!data.url) {
          reject(new Error('url column missing from adUrlCrawlList'));
        }
        urls.push(data.url);
        adIds.push(Number.parseInt(data.ad_id));
      }).on('end', () => {
        resolve();
      });
  }));
  for (let i = 0; i < urls.length; i++) {
    let crawlName = `landing_page_for_ad_${adIds[i]}`;

    let completedCrawl = await client.query('SELECT * FROM crawl WHERE name=$1 and completed=true', [crawlName]);
    if (completedCrawl.rows.length > 0) {
      console.log(`Crawl ${crawlName} already completed. Skipping.`);
      continue;
    }

    let message: CrawlerFlagsWithProfileHandling = {
      "jobId": jobId,
      "crawlName": `landing_page_for_ad_${adIds[i]}`,
      "outputDir": jobSpec.containerDataDir,
      "resumeIfAble": true,
      "url": urls[i],
      "adId": adIds[i],
      "chromeOptions": {
        "headless": true,
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
  return crawlMessages;
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
        let message = messages.shift();
        ok = channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { priority: 1 });
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
// be copied into the container and/or saved after the crawl. See jobSpec
// for details on each field.
interface CrawlerFlagsWithProfileHandling extends CrawlerFlags {
  profileOptions: {
    useExistingProfile: boolean;
    writeProfile: boolean;
    profileDir?: string;
    newProfileDir?: string;
    sshHost?: string;
    sshRemotePort?: number;
    sshKey?: string;
  }
}
