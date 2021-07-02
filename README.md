# adscraper: A Web Crawler for Measuring Online Ad Content

**adscraper** is a tool for scraping online ads. Given a website (or a list of
websites), it opens the website in a Chromium browser, and takes a screenshot
and saves the HTML content of each ad on the page.

## Components
- The adscraper **crawler** is a Node.js script that uses the
[puppeteer](https://github.com/puppeteer/puppeteer) library to automatically
browse and collect ad data. You can use the crawler via the command line to
crawl a single site, or you can use it as part of your own Node.JS script.

- The adscraper **crawl-coordinator** is a script for crawling a list of
websites, using a pool of parallel crawlers, in isolated Docker containers.
Each crawler and browser instance, for each website, uses a new Docker container,
meaning that each site is crawled with a "fresh" profile, with no cookies,
application storage, or history. You can also connect crawl-coordinator to
a Wireguard-based VPN, to tunnel crawls through a different IP address in a
different location.

## Research using adscraper
adscraper has been used to conduct research measuring and auditing the online
ads ecosystem. You can read about some of the projects that used adscraper below:
- [(Project website) Bad Ads: Problematic Content in Online Advertising](https://badads.cs.washington.edu)
- [(Paper) What Makes a "Bad" Ad? User Perceptions of Problematic Online Advertising](https://badads.cs.washington.edu/files/Zeng-CHI2021-BadAds.pdf)
- [(Paper) Bad News: Clickbait and Deceptive Ads on News and Misinformation Websites](https://badads.cs.washington.edu/files/Zeng-ConPro2020-BadNews.pdf)

# Warning: Research Code!
adscraper is not yet production quality code - most of this was written for our
specific research projects, and may not work for your specific use case, and
may contain various bugs and defects.

If you are running into issues with the code or documentation, please let us
know by filing an issue or asking a question in the discussions. I will also
accept pull requests for fixing bugs, doc bugs, or making the project more
generally usable and configurable.


# Prerequisites
To run adscraper, you must have the following software installed:
- Node.js
- TypeScript
- PostgreSQL
- Docker (for isolated/parallel crawls via [crawl-coordinator](crawl-coordinator))


# Installation
This section will help you install and configure adscraper. For our initial
release, adscraper will be a Node.js script that you run directly out of the
repository, but in the future, we may refactor it into a library that you
can use in your own project.

First, clone this repository.
```
git clone <url>
```

Second, install Typescript globally via npm. This is not strictly necessary but
can be helpful for development/writing your own scripts based on adscraper.
```
npm install -g typescript
```

Further setup and installation instructions for the basic `crawler` script
and the parallelized `crawl-coordinator` script are described in the next
section.

# Usage

## Running Basic Crawls
This is a guide for running basic crawls using `crawler`. The crawler script
scrapes ads from a single website, without the Docker-based profile isolation.

### Setup 
First, you must have a PostgreSQL database that has the schema defined in
`db/adscraper.sql`. You can set this up yourself, or follow the instructions
in [db/README.md](db/README.md).

Then, install dependencies and compile the code in the `crawler` directory.
```
cd crawler
npm install
npm run build
```


### Commands

The main script for the basic, CLI-based crawler is the Typescript
file `src/crawler-cli.ts`.
To compile the script run the following command:
```
npm run build  # or npx tsc, or tsc if you have Typescript installed globally
```

The compiled script is now at `src/crawler-cli.js`. To run the script, run:
```
node gen/crawler-cli.js
```
The `--help` flag will show the command line options.

### Example
In this example, we create a JSON configuration file for the Postgres database, in the
`crawler/` directory. The file is named `pg_conf.json`:
```json
{
  "host": "localhost",
  "port": 5432,
  "database": "adscraper",
  "user": "adscraper",
  "password": "example_password_12345"
}
```

Create a directory for storing screenshots:
```
mkdir ~/adscraper_screenshots
```

Currently, crawls must be associated with a _job_. We need to manually create
a job in the postgres database. We'll do this using the psql command line interface.
```sh
psql -h localhost -U adscraper
```
```sql
adscraper=# INSERT INTO job (name, timestamp) VALUES ('test crawl', NOW());
```
(Use CTRL+d to exit.)


This command runs a crawl on the homepage and an article on _nytimes.com_.
```sh
node gen/crawler-cli.js \
  --job_id 1 \
  --max_page_crawl_depth 2 \
  --url https://nytimes.com \
  --screenshot_dir ~/adscraper_screenshots/ \
  --label news \
  --pg_conf_file pg_conf.json \
  --crawl_article
```

## Crawling lists of sites in parallel and in isolation
Using `crawl-coordinator`, you can crawl a large list of sites with a single
command, using parallel crawler instances. `crawl-coordinator` also ensures
that each crawl has a fresh profile, by using a separate Docker container
for each site in the list.

### Setup

First, to run crawl-coordinator, you must run a Postgres database in a Docker
container, connected to a Docker bridge network called `adscraper`. 
For instructions, please read the section titled "Setup (for Docker-based 
crawls)" in [db/README.md](db/README.md).

Next, install dependencies and compile the code in both 
`crawl-coordinator` and `crawler`.

```
cd crawler
# Install crawler deps
npm install
# Build Docker image for crawler
npm run build:docker

cd ../crawl-coordinator
# Install crawl-coordinator deps
npm install
# Compile crawl-coordinator
npm run build
```

**Note for Windows users:** Ensure that `crawler/start.sh` has Unix-style LF 
line endings, and not Windows-style CRLF line endings, before building
the crawler image (`npm run build:docker`). If your Git is configured to 
check out files with CRLF endings, you may have to do this manually. I use 
Notepad++ -> Edit -> EOL Conversion -> LF.


### Commands
The main script for the basic, CLI-based crawler is the Typescript
file `src/crawl-coordinator.ts`.
To compile the script run the following command:
```
npm run build  # or npx tsc, or tsc if you have Typescript installed globally
```

The compiled script is now at `src/crawl-coordinator.js`. To run the script, run:
```
node gen/crawl-ccoordinator.js
```
This will show the command line options.

### Example

First, we create a Postgres database in Docker, per instructions in 
[db/README.md](db/README.md), if you have not already.
```sh
docker pull postgres:13
docker network create adscraper
docker volume create adscraper_data
docker run \
  --name adscraper-postgres \
  --mount source=adscraper_data,target=/var/lib/postgresql/data \
  --net adscraper \
  -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=adscraper \
  -e POSTGRES_PASSWORD=example_password_12345 \
  -d \
  postgres:13
psql -d adscraper -U adscraper -h localhost -p 5432 -f ../db/adscraper.sql
```

Next, create a postgres credentials file, named `pg_conf.json`, (anywhere is fine, but in the main repo folder in this example):
```json
{
  "host": "localhost",
  "port": 5432,
  "database": "adscraper",
  "user": "adscraper",
  "password": "example_password_12345"
}
```

Then, create a CSV file containing the sites you want the crawlers to visit,
named `input_sites.csv` (anywhere is fine, but in the main repo folder in this example).
```csv
url,label
nytimes.com,news
arstechnica.com,news
sourceforge.com,software
speedtest.net,software
```

Create a directory for storing screenshots and logs:
```
mkdir ~/adscraper_screenshots
mkdir ~/adscraper_logs
```

Lastly, run this command to start a crawl:
```sh
node gen/crawl-coordinator.js \
  --inputs input_sites.csv \
  --job_name my_first_crawl \
  --screenshot_dir ~/adscraper_screenshots/ \
   --log_dir ~/adscraper_logs \
   --pg_conf_file ../pg_conf.json \
   --num_workers 4 \
   --crawl_article \
   --screenshot_ads_with_context \
   --pg_container adscraper-postgres \
   --pg_container_port 5432 \
   --shuffle
```

## Example: VPN crawl
If you want to crawl through a VPN (e.g. to simulate crawling from a different
location), you can supply a few additional arguments to the crawler. However,
you must also do additional setup to make your database accessible to the
crawler (e.g. make the database accessible over the internet), as the crawler
containers will tunnel all traffic through the VPN.

(This is a work in progress - we made this work for some research code, but
it is currently quite janky.)

```
node gen/crawl-coordinator.js -i
  --inputs ../input_sites.csv \
  --job_name my_first_crawl \
  --screenshot_dir ~/adscraper_screenshots/ \
  --log_dir ~/adscraper_logs \
  --pg_conf_file ./pg_conf.json \
  --num_workers 4 \
  --crawl_article \
  --screenshot_ads_with_context \
  --shuffle \
  --geolocation London \
  --vpn docker \
  --vpn_hostname london_vpn_endpoint.example.com \
  --wireguard_conf my_wireguard_conf.conf
```

## Writing your own crawl script
Instead of running the crawler-cli command one site at a time, or using
crawl-coordinator (if you don't want all of the heavy-weight isolation features),
you can write your own Node.js script to automate the crawler.

Example: create a file at `crawler/src/myCrawlScript.ts`
```ts
import * as crawler from './crawler';
import { Client } from 'node-postgres';

(async () => {
  let postgres = new Client({
    "host": "localhost",
    "port": 5432,
    "database": "adscraper",
    "user": "adscraper",
    "password": "example_password_12345"
  });
  await postgres.connect();

  const sites = [
    'https://www.nytimes.com',
    'https://www.washingtonpost.com',
    'https://yahoo.com',
    'https://www.usatoday.com'
  ];

  for (let site of sites) {
    try {
      await crawler.crawl({
        clearCookiesBeforeCT: false,
        crawlArticle: true,
        crawlerHostname: 'localhost',
        crawlPageWithAds: false,
        dataset: 'test',
        disableAllCookies: false,
        disableThirdPartyCookies: false,
        jobId: 1,
        label: 'news',
        maxPageCrawlDepth: 2,
        screenshotAdsWithContext: true,
        screenshotDir: '~/adscraper_screenshots/',
        skipCrawlingSeedUrl: false,
        url: site,
        warmingCrawl: false,
        updateCrawlerIpField: false
      }, postgres);

    } catch (e) {
      console.log(e);
    }
  }
  await postgres.end();
  process.exit(0);
});

```

For now, the script needs to go in the crawler directory - in the future, we may
make this available as a npm library.
