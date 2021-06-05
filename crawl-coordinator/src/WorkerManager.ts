import csvParser from 'csv-parser';
import Docker from 'dockerode';
import { EventEmitter } from 'events';
import fs from 'fs';
import ContainerLogTransformer from './ContainerLogTransformer';
import { SeedSite, SeedSiteCSVRow } from './SeedSite';

interface WorkerStatus {
  [containerId: string]: SeedSite
}

interface WorkerManagerOptions {
  inputFiles: string[],
  numWorkers: number,
  maxCrawlDepth: number,
  crawlArticle: boolean,
  crawlPageWithAds: boolean,
  skipCrawlingSeedUrl: boolean,
  screenshotAdsWithContext: boolean,
  shuffle: boolean,
  warm: boolean,
  disableAllCookies: boolean,
  disableThirdPartyCookies: boolean,
  clearCookiesBeforeCT: boolean,
  pgHost: string,
  pgPort: number,
  pgUser: string,
  pgPassword: string,
  pgDatabase: string,
  screenshotDir: string,
  crawlerHostname: string
}

// This class is used for managing the state of the crawl, and starting new
// crawl workers.
export default class WorkerManager extends EventEmitter {
  options: WorkerManagerOptions;
  currentDatasetIndex: number;
  currentUrlIndex: number;
  seedSites: Array<SeedSite>;
  docker: Docker;
  jobId: number;
  workers: WorkerStatus;
  dockerNetwork?: string;

  constructor(options: WorkerManagerOptions, docker: Docker) {
    super();
    this.options = options;
    this.currentDatasetIndex = 0;
    this.currentUrlIndex = 0;
    this.seedSites = [];
    this.docker = docker;
    this.jobId = -1;
    this.dockerNetwork = undefined;
    this.workers = {};
  }

  // Reads the data from the input CSVs and converts them into SeedSites.
  // Run after the constructor (can't use async calls in there).
  async initializeCrawl() {
    for (let csvFile of this.options.inputFiles) {
      try {
        let sites = await this.openCsv(csvFile);
        this.seedSites = this.seedSites.concat(sites);
      } catch (e) {
        console.log('Failed to open CSV: ' + csvFile);
        console.log(e);
      }
    }
    if (this.options.shuffle) {
      for (let i = this.seedSites.length - 1; i >= 1; i--) {
        let j = Math.round(Math.random() * i);
        let temp = this.seedSites[i];
        this.seedSites[i] = this.seedSites[j];
        this.seedSites[j] = temp;
      }
    }
    if (this.options.warm) {
      const warmSampleRate = 0.25;
      const warmingSites: SeedSite[] = [];
      const sampled = new Set<number>();
      for (let i = 0; i < this.seedSites.length * warmSampleRate; i++) {
        let idx = Math.round(Math.random() * (this.seedSites.length - 1));
        while (sampled.has(idx)) {
          idx = Math.round(Math.random() * (this.seedSites.length - 1));
        }
        let warmingSite = Object.assign({}, this.seedSites[idx]);
        warmingSite.warming_crawl = true;
        warmingSites.push(warmingSite);
        sampled.add(idx);
      }
      this.seedSites = warmingSites.concat(this.seedSites);
    }
    for (let i = 0; i < this.options.numWorkers; i++) {
      try {
        await this.startNextCrawl(i == 0);
      } catch (e) {
        console.log(e);
      }
    }
  }

  markDone(containerId: string) {
    delete this.workers[containerId];
    if (this.seedSites.length === 0 && Object.keys(this.workers).length == 0) {
      this.emit('jobcompleted');
    }
  }

  setJobId(jobId: number) {
    this.jobId = jobId;
  }

  setNetwork(network: string | undefined) {
    this.dockerNetwork = network;
  }

  // Starts a crawl worker job for the next URL. Returns the log stream from
  // the worker's container, or undefined if there are no more URLs left.
  async startNextCrawl(first: boolean) {
    const nextSite = this.seedSites.shift();
    if (!nextSite) {
      throw new Error('End of crawl list');
    }
    await this.startWorkerContainer(nextSite, first);
  }

  // Starts a worker container for the given seed site.
  async startWorkerContainer(seedSite: SeedSite, first: boolean) {
    let url = seedSite.url;
    if (!url.startsWith('http://') && ! url.startsWith('https://')) {
      url = 'http://' + url;
    }

    let cmd = [
      '--pg_host', this.options.pgHost,
      '--pg_port', this.options.pgPort.toString(),
      '--pg_user', this.options.pgUser,
      '--pg_password', this.options.pgPassword,
      '--pg_database', this.options.pgDatabase,
      '--job_id', this.jobId.toString(),
      '--max_page_crawl_depth', this.options.maxCrawlDepth.toString(),
      '--url', url,
      '--dataset', seedSite.dataset,
      '--screenshot_dir', '/data/screenshots',
      '--external_screenshot_dir', this.options.screenshotDir,
      '--crawler_hostname', this.options.crawlerHostname,
    ];
    if (seedSite.label) {
      cmd.push('--label', seedSite.label);
    }
    if (seedSite.warming_crawl) {
      cmd.push('--warming_crawl');
    }
    if (this.options.disableAllCookies) {
      cmd.push('--disable_all_cookies');
    }
    if (this.options.disableThirdPartyCookies) {
      cmd.push('--disable_third_party_cookies');
    }
    if (this.options.clearCookiesBeforeCT) {
      cmd.push('--clear_cookies_before_ct');
    }
    if (this.options.crawlArticle) {
      cmd.push('--crawl_article');
    }
    if (this.options.crawlPageWithAds) {
      cmd.push('--crawl_page_with_ads');
    }
    if (this.options.skipCrawlingSeedUrl) {
      cmd.push('--skip_crawling_seed_url');
    }
    if (this.options.screenshotAdsWithContext) {
      cmd.push('--screenshot_ads_with_context');
    }
    if (first) {
      cmd.push('--update_crawler_ip_field')
    }
    console.log(cmd.join(' '));

    let worker = await this.docker.createContainer({
      Cmd: cmd,
      HostConfig: {
        CapAdd: ['SYS_ADMIN'],
        // @ts-ignore
        Init: true,
        Labels: {
          url: url
        },
        Mounts: [{
          Target: '/data/screenshots',
          Source: this.options.screenshotDir,
          Type: 'bind',
        }],
        NetworkMode: this.dockerNetwork
      },
      Image: 'puppeteer-chrome-linux',
      name: `crawler-${Date.now()}-${new URL(url).hostname}`
    });
    await worker.start({});

    const containerLogStream = await worker.logs({
      stdout: true,
      stderr: true,
      follow: true,
      timestamps: false,
    });
    const containerInfo = await worker.inspect();

    let containerLogTransformer = new ContainerLogTransformer(
      containerInfo.Name, containerInfo.Id);
    containerLogStream.pipe(containerLogTransformer);
    this.emit('workerstarted', containerLogTransformer);
  }

  // Reads CSV data into an array of SeedSites
  openCsv(path: string): Promise<SeedSite[]> {
    return new Promise((resolve, reject) => {
      let results: SeedSite[] = [];
      fs.createReadStream(path)
        .pipe(csvParser())
        .on('data', (row: SeedSiteCSVRow) => {
          results.push({
            dataset: path,
            warming_crawl: false,
            ...row
          });
        })
        .on('end', () => {
          resolve(results);
        });
    });
  }
}