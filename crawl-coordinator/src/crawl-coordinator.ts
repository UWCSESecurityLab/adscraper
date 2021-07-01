import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';
import Docker from 'dockerode';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import sourcemap from 'source-map-support';
import DockerEventTransformer from './DockerEventTransformer';
import LogMonitor from './LogMonitor';
import WorkerManager from './WorkerManager';
import os from 'os';
import publicIp from 'public-ip';
import { DOCKER_NETWORK } from './constants';
import { getContainerIp } from './storage';
sourcemap.install();

// Default param values
const DEFAULT_MAX_PAGE_CRAWL_DEPTH = 2;
const DEFAULT_NUM_WORKERS = 8;

const optionsDefinitions: commandLineUsage.OptionDefinition[] = [
  {
    name: 'help',
    alias: 'h',
    type: Boolean,
    description: 'Display this usage guide.',
    defaultValue: false,
    group: 'main'
  },
  {
    name: 'inputs',
    alias: 'i',
    type: String,
    multiple: true,
    typeLabel: '<files>',
    description: 'CSV files containing sites to crawl. Required.',
    defaultValue: [],
    group: 'main'
  },
  {
    name: 'log_dir',
    type: String,
    description: 'Directory where crawler logs will be written.',
    group: 'main'
  },
  {
    name: 'screenshot_dir',
    type: String,
    description: 'Directory where screenshots will be saved.',
    group: 'main'
  },
  {
    name: 'job_name',
    type: String,
    description: '(Optional) Helpful name for referencing this job in the database.',
    group: 'main'
  },
  {
    name: 'max_page_crawl_depth',
    alias: 'd',
    type: Number,
    description: `The maximum depth of pages to crawl. (Default = ${DEFAULT_MAX_PAGE_CRAWL_DEPTH})`,
    defaultValue: 2,
    group: 'main'
  },
  {
    name: 'num_workers',
    alias: 'w',
    type: Number,
    description: `The number of parallel puppeteer crawl workers to run. (Default = ${DEFAULT_NUM_WORKERS})`,
    defaultValue: 8,
    group: 'main'
  },
  {
    name: 'crawl_article',
    alias: 'a',
    type: Boolean,
    description: 'Crawl in article mode: in addition to crawling the home page, crawl the first article in the site\'s RSS feed. (Default = false)',
    defaultValue: false,
    group: 'main'
  },
  {
    name: 'crawl_page_with_ads',
    type: Boolean,
    description: 'Crawl page with ads: in addition to crawling the home page, crawl a page on this domain that has ads. (Default = false)',
    defaultValue: false,
    group: 'main'
  },
  {
    name: 'screenshot_ads_with_context',
    type: Boolean,
    description: 'When screenshotting ads, include a margin around the ad to provide page context. (Default = false)',
    defaultValue: false,
    group: 'main'
  },
  {
    name: 'pg_conf_file',
    type: String,
    description: 'JSON file with the Postgres connection parameters: host, port, database, user, password. If no file is supplied, these can also be passed in the below command line flags.',
    group: 'pg'
  },
  {
    name: 'pg_host',
    type: String,
    description: 'Hostname of postgres instance. If crawling through a VPN (--vpn) and the database is not on the same host, must be a public domain/IP address. (Default: localhost)',
    defaultValue: 'localhost',
    group: 'pg'
  },
  {
    name: 'pg_port',
    type: Number,
    description: 'Port of postgres instance. (Default: 5432)',
    defaultValue: 5432,
    group: 'pg'
  },
  {
    name: 'pg_database',
    type: String,
    description: 'Name of postgres database. (Default: adscraper)',
    defaultValue: 'adscraper',
    group: 'pg'
  },
  {
    name: 'pg_user',
    type: String,
    description: 'Name of postgres user',
    group: 'pg'
  },
  {
    name: 'pg_password',
    type: String,
    description: 'Password for postgres user',
    group: 'pg'
  },
  {
    name: 'pg_container',
    type: String,
    description: 'The name or ID of the Docker container running the Postgres database, if Postgres is running in a Docker container on the same Docker bridge network.',
    group: 'pg'
  },
  {
    name: 'pg_container_port',
    type: Number,
    description: 'The container-internal port of the Postgres database, if Postgres is running in a Docker container, and the internal port is NOT the same as the external port exposed to the host machine.',
    defaultValue: 5432,
    group: 'pg'
  },
  {
    name: 'job_id',
    type: Number,
    alias: 'j',
    description: 'Job number to use, if resuming a crawl. (Default = none)',
    group: 'resume'
  },
  {
    name: 'skip_crawling_seed_url',
    type: Boolean,
    description: 'Skip crawling the seed_url page, and any ads on it. Will still crawl articles if -a is passed. (Default = false)',
    defaultValue: false,
    group: 'resume'
  },
  {
    name: 'shuffle',
    type: Boolean,
    defaultValue: false,
    description: 'Randomize the order of the seed sites crawled',
    group: 'anti_track'
  },
  {
    name: 'warm',
    type: Boolean,
    description: `Crawls the input dataset without saving data, to 'warm' the machine's targeting profile, ensuring that all sites have been visited once before collecting data.`,
    defaultValue: false,
    group: 'anti_track'
  },
  {
    name: 'disable_all_cookies',
    type: Boolean,
    description: 'Disable all cookies in the browser',
    defaultValue: false,
    group: 'anti_track'
  },
  {
    name: 'disable_third_party_cookies',
    type: Boolean,
    defaultValue: false,
    description: 'Disable third party cookies and document.cookie',
    group: 'anti_track'
  },
  {
    name: 'clear_cookies_before_ct',
    type: Boolean,
    description: 'Clear browser cookies before clicking ads.',
    defaultValue: false,
    group: 'anti_track'
  },
  {
    name: 'crawler_hostname',
    type: String,
    description: 'Hostname of crawler machine. Defaults to os.hostname().',
    defaultValue: os.hostname(),
    group: 'main'
  },
  {
    name: 'geolocation',
    type: String,
    description: 'Geolocation of the crawler, or the VPN it tunnels though (optional).',
    group: 'main'
  },
  {
    name: 'vpn',
    type: String,
    description: 'Specify VPN configuration used for crawling, if desired. Valid options are "system", for VPNs running on the host (you must manage this yourself), "docker" to have the crawl master launch a Wireguard Docker container (supply the configuration using --wireguard_conf).',
    group: 'vpn'
  },
  {
    name: 'vpn_hostname',
    type: String,
    description: 'Hostname of the VPN used by the crawler (optional, for recording in database).',
    group: 'vpn'
  },
  {
    name: 'wireguard_conf',
    type: String,
    description: 'If --vpn is set to "docker", crawl-master will start a Wireguard instance in a Docker container using this file.',
    group: 'vpn'
  }
];

const options = commandLineArgs(optionsDefinitions)._all;
console.log(options);
const isEmpty = (arr: string[] | undefined) => !arr || arr.length === 0;
if (options.help || isEmpty(options.inputs)) {
  console.log(commandLineUsage([
    {
      header: 'AdScraper Crawl Master',
      content: 'This script coordinates the workers that crawl pages and ads.'
    },
    {
      header: 'Main Crawler Configuration',
      optionList: optionsDefinitions,
      group: 'main'
    },
    {
      header: 'Database Configuration',
      optionList: optionsDefinitions,
      group: 'pg'
    },
    {
      header: 'VPN Configuration',
      optionList: optionsDefinitions,
      group: 'vpn'
    },
    {
      header: 'Backfilling and Resuming Crawls',
      optionList: optionsDefinitions,
      group: 'resume'
    },
    {
      header: 'Anti-Tracking/Targeting Mitigations',
      optionList: optionsDefinitions,
      group: 'anti_track'
    }
  ]));
  process.exit(!options.inputs ? 1 : 0);
}


const docker = new Docker();

if (!fs.existsSync(options.screenshot_dir) || !fs.lstatSync(options.screenshot_dir).isDirectory()) {
  console.log(`${options.screenshot_dir} is not a valid directory for --screenshot_dir`);
  process.exit(1);
}

if (!fs.existsSync(options.log_dir) || !fs.lstatSync(options.log_dir).isDirectory()) {
  console.log(`${options.log_dir} is not a valid directory for --log_dir`);
  process.exit(1);
}

if (options.vpn && options.vpn !== 'docker' && options.vpn !== 'system') {
  console.log(`${options.vpn} is not a valid value for --vpn, must be either "docker" or "system".`);
  process.exit(1);
}

if (options.vpn === 'docker' && !options.wireguard_conf) {
  console.log('Must supply Wireguard config with --wireguard_conf if using "--vpn docker" option');
  process.exit(1);
}
if (options.vpn === 'docker' && !fs.existsSync(options.wireguard_conf)) {
  console.log(`Couldn't find Wireguard config file at ${options.wireguard_conf}.`);
  process.exit(1);
}
if (options.pg_container && options.vpn) {
  console.log('Error: cannot use VPN with Docker-based Postgres. Only one of --vpn or --pg_container can be used.');
  process.exit(1);
}

let pgConf: {
  host: string,
  port: number,
  user: string,
  password: string,
  database: string
};

if (options.pg_conf_file && fs.existsSync(options.pg_conf_file)) {
  pgConf = JSON.parse(fs.readFileSync(options.pg_conf_file).toString());
} else {
  pgConf = {
    host: options.pg_host,
    port: options.pg_port,
    user: options.pg_user,
    password: options.pg_password,
    database: options.pg_database
  }
}

// Initialize logging
const logPath = path.resolve(options.log_dir, `crawl_${new Date().toISOString()}.json`);
const logFileStream = fs.createWriteStream(logPath);
logFileStream.write('[');

(async () => {
  let wireguard: Docker.Container;

  let jobId = options.job_id as number | undefined;

  // Special case for postgres host: if postgres is running on the same
  // machine as the crawler, and it's a dockerized VPN crawl, the crawlers
  // need to connect to the public ip, not localhost.
  let crawler_pg_host = pgConf.host;
  let crawler_pg_port = pgConf.port;
  if (options.vpn === 'docker' && (pgConf.host === 'localhost' || pgConf.host === '127.0.0.1')) {
    let publicIp = await getPublicIp();
    if (!publicIp) {
      console.log('Error: Could not find a public IP for this host. Crawlers will not be able to connect to the postgres database.');
      process.exit(1);
    }
    crawler_pg_host = publicIp;
  } else if (options.pg_container && (pgConf.host === 'localhost' || pgConf.host === '127.0.0.1')) {
    const containerIp = await getContainerIp(docker, options.pg_container);
    if (!containerIp) {
      console.log(`Error: could not find a running container with the id or name ${options.pg_container} on the Docker network ${DOCKER_NETWORK}`);
      process.exit(1);
    }
    crawler_pg_host = containerIp;
    console.log(`Postgres Container IP is: ${crawler_pg_host}`);
  }
  if (options.pg_container_port && (pgConf.host === 'localhost' || pgConf.host === '127.0.0.1')) {
    crawler_pg_port = options.pg_container_port;
  }

  // Initialize logging stream pipeline
  const manager = new WorkerManager({
    inputFiles: options.inputs,
    numWorkers: options.num_workers,
    maxCrawlDepth: options.max_page_crawl_depth,
    crawlArticle: options.crawl_article,
    crawlPageWithAds: options.crawl_page_with_ads,
    skipCrawlingSeedUrl: options.skip_crawling_seed_url,
    screenshotAdsWithContext: options.screenshot_ads_with_context,
    shuffle: options.shuffle,
    warm: options.warm,
    disableAllCookies: options.disable_all_cookies,
    disableThirdPartyCookies: options.disable_third_party_cookies,
    clearCookiesBeforeCT: options.clear_cookies_before_ct,
    pgHost: crawler_pg_host,
    pgPort: crawler_pg_port,
    pgUser: pgConf.user,
    pgPassword: pgConf.password,
    pgDatabase: pgConf.database,
    screenshotDir: options.screenshot_dir,
    crawlerHostname: options.crawler_hostname
  }, docker);

  const dockerEventTransformer = new DockerEventTransformer();
  const logMonitor = new LogMonitor();

  const eventStream = await docker.getEvents();
  eventStream
    .pipe(dockerEventTransformer)
    .pipe(logMonitor)
    .pipe(logFileStream, { end: false });

  logMonitor.on('workercompleted', async (containerId: string) => {
    manager.markDone(containerId);
    try {
      await manager.startNextCrawl(false);
    } catch (e) {
      if (e.message === 'End of crawl list') {
        console.log('Reached end of crawl list');
      } else {
        console.log(e);
      }
    }
  });

  manager.on('workerstarted', (containerLogStream: NodeJS.ReadableStream) => {
    containerLogStream.pipe(logMonitor, { end: false });
  });

  manager.on('jobcompleted', async () => {
    let errored = false;
    try {
      const completionTime = new Date();
      console.log(`Crawl job ${jobId} completed at ${completionTime.toLocaleString()}`);
      await postgres.query(
        `UPDATE job SET completed=true, completion_time=$1 WHERE id=$2`,
        [completionTime, jobId]);
      if (wireguard) {
        console.log('Shutting down Wireguard');
        await wireguard.stop();
      }
      await postgres.end();
    } catch (e) {
      console.log(e);
      errored = true;
    } finally {
      logFileStream.write(']\n', () => {
        logFileStream.end();
        process.exit(errored ? 1 : 0);
      });
    }
  });

  // Connect to postgres, insert new entry for job
  const pgTimeout = setTimeout(() => {
    console.log(`Could not connect to postgres instance at ${pgConf.host}:${pgConf.port}`);
    process.exit(1);
  }, 10000)
  const postgres = new Client(pgConf);
  await postgres.connect();
  clearTimeout(pgTimeout);
  console.log('Connected to postgres');

  if (!jobId) {
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
    jobId = queryResult.rows[0].id as number;
  }
  manager.setJobId(jobId);

  // Set up network for crawler containers, containerized VPN
  let dockerNetwork = DOCKER_NETWORK;
  if (options.vpn === 'docker') {
    try {
      const containerName = `wireguard-${jobId}`;
      dockerNetwork = `container:${containerName}`;

      wireguard = await docker.createContainer({
        HostConfig: {
          CapAdd: ['NET_ADMIN', 'SYS_MODULE'],
          Mounts: [{
            Target: '/etc/wireguard/mullvad.conf',
            Source: path.resolve(options.wireguard_conf),
            Type: 'bind'
          }],
          Sysctls: {
            'net.ipv4.conf.all.src_valid_mark': '1',
            'net.ipv6.conf.default.disable_ipv6': '0'
          }
        },
        Image: 'jordanpotter/wireguard',
        name: containerName
      });
      await wireguard.start();
    } catch (e) {
      console.log(e);
      process.exit(1);
    }
  }

  manager.setNetwork(dockerNetwork);

  console.log('Starting crawl...');
  await manager.initializeCrawl();
})();

async function getPublicIp() {
  try {
    let v4 = await publicIp.v4();
    if (v4) {
      return v4;
    }
  } catch (e) {
    console.log(e);
    try {
      let v6 = await publicIp.v6();
      if (v6) {
        return v6;
      }
    } catch (e) {
      console.log(e);
      return null;
    }
  }
}