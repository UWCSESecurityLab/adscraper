# adscraper: A Web Crawler for Measuring Online Ad Content

**adscraper** is a tool for scraping online ads. Given a website (or a list of
websites), it opens the website in a Chromium browser, and takes a screenshot
and saves the HTML content of each ad on the page.

- [adscraper: A Web Crawler for Measuring Online Ad Content](#adscraper-a-web-crawler-for-measuring-online-ad-content)
  - [Introduction](#introduction)
    - [Research using adscraper](#research-using-adscraper)
    - [Warning: Research Code!](#warning-research-code)
  - [Setup](#setup)
    - [Prerequisites](#prerequisites)
    - [Installation](#installation)
  - [Crawler Usage](#crawler-usage)
    - [Create input file(s) and output directories](#create-input-files-and-output-directories)
    - [Running a basic crawl to scrape ads](#running-a-basic-crawl-to-scrape-ads)
    - [Collecting ad URLs and landing pages](#collecting-ad-urls-and-landing-pages)
    - [Using profiles](#using-profiles)
    - [Advanced example: collecting ads and landing pages in separate profiles](#advanced-example-collecting-ads-and-landing-pages-in-separate-profiles)
    - [Resuming a failed crawl](#resuming-a-failed-crawl)
    - [Other command line options](#other-command-line-options)

## Introduction

Adscraper is a Node.js script that uses the
[puppeteer](https://github.com/puppeteer/puppeteer) library to automatically
browse and collect ad data. You can use the crawler via the command line to
crawl a single site, or you can use it as part of your own Node.JS script.

### Research using adscraper

adscraper has been used to conduct research measuring and auditing the online
ads ecosystem. You can read about some of the projects that used adscraper below:

- [(Project website) Bad Ads: Problematic Content in Online Advertising](https://badads.cs.washington.edu)
- [(Paper) Polls, Clickbait, and Commemorative $2 Bills: Problematic Political Advertising on News and Media Websites Around the 2020 U.S. Elections](https://badads.cs.washington.edu/political.html)
- [(Paper) What Makes a "Bad" Ad? User Perceptions of Problematic Online Advertising](https://badads.cs.washington.edu/files/Zeng-CHI2021-BadAds.pdf)
- [(Paper) Bad News: Clickbait and Deceptive Ads on News and Misinformation Websites](https://badads.cs.washington.edu/files/Zeng-ConPro2020-BadNews.pdf)

### Warning: Research Code!

`adscraper` is not  production quality code - most of this was written for our
specific research projects, and may not work for your specific use case, and
may contain various bugs and defects.

If you are running into issues with the code or documentation, please let us
know by filing an issue or asking a question in the discussions. I will also
accept pull requests for fixing bugs, doc bugs, or making the project more
generally usable and configurable.

## Setup

### Prerequisites

To run adscraper, you must have the following software installed:

- Node.js
- TypeScript
- PostgreSQL
- Docker (for isolated/parallel crawls via [crawl-coordinator](crawl-coordinator))

### Installation

This section will help you install and configure adscraper. For our initial
release, adscraper will be a Node.js script that you run directly out of the
repository, but in the future, we may refactor it into a library that you
can use in your own project.

**Get the source code**.
First, clone this repository.

```sh
git clone https://github.com/UWCSESecurityLab/adscraper.git
```

**Set up the database.**
Next, create a Postgres database, using the schema specified in
[db/adscraper.sql](db/adscraper.sql). Metadata from crawls will be stored
in here. You can either copy the code into the `psql` command line, or run
the following command:

```sh
psql -U <YOUR_POSTGRES_USERNAME> -f ./adscraper.sql
```

This creates a database named `adscraper` and populates it with the tables
and indices provided.

Then, create a JSON file containing the authentication
credentials for your Postgres server. The format of the JSON file is the
[config file used by node-postgres](https://node-postgres.com/apis/client#new-client). For example:

```json
{
  "host": "localhost",
  "port": 5432,
  "database": "adscraper",
  "user": "<your postgres username>",
  "password": "<your postgres password>"
}
```

**Build the project.**
Lastly, install the Node dependencies and compile the code in the `crawler` directory.

```sh
cd crawler
npm install
npm run build
```

## Crawler Usage

This is a guide for running individual crawler instances using `crawler`.

### Create input file(s) and output directories

First, you need to create a **crawl list** - the URLs that the crawler will visit.
The format is a text file containing one URL per line. For example:

```txt
https://www.nytimes.com/
https://www.cnn.com/
```

Next, create an **output directory**, where the crawler will save screenshots,
HTML files, and MHTML snapshots. Other metadata will be stored in the
Postgres database. The structure of the directory, when populated,
will look like this:

```txt
output_dir/
├─ <crawl name>/
│  ├─ scraped_ads/
│  │  ├─ ad_<id>/
│  │  │  ├─ ad_<id>.webp
│  │  │  ├─ ad_<id>_landing_page_screenshot.webp
│  │  │  ├─ ad_<id>_landing_page_content.html
│  │  │  ├─ ad_<id>_landing_page_snapshot.mhtml
│  ├─ scraped_pages/
│  │  ├─ <url>/
│  │  │  ├─ <url>_screenshot.webp
│  │  │  ├─ <url>_content.html
│  │  │  ├─ <url>_snapshot.mhtml
```

### Running a basic crawl to scrape ads

Now that the inputs, outputs, and database are set up, we can run some
crawls. The simplest crawl configuration is to scrape screenshots of ads from
a list of URLs, using the `--scrape_ads` options.

```sh
node gen/crawler-cli.js \
    --name example_crawl_name \
    --output_dir /path/to/your/output/dir \
    --crawl_list /path/to/your/crawl/list \
    --pg_conf_file /path/to/your/postgres/config \
    --scrape_ads \
    --click_ads=noClick
```

The ads will be stored in the `ad` table in the database. Additionally,
screenshots of the ads will be stored in
`<output_dir>/<crawl_name>/scraped_ads/ad_<id>`, using the same id as in Postgres.
The `ad` table also contains the path to the screenshot under the `screenshot`
column.

Additionally, if we want screenshots/snapshots of the pages the ads appeared on,
we can add the `--scrape_site` option.

```sh
node gen/crawler-cli.js \
    --name example_crawl_name \
    --output_dir /path/to/your/output/dir \
    --crawl_list /path/to/your/crawl/list \
    --pg_conf_file /path/to/your/postgres/config \
    --scrape_ads \
    --scrape_site \
    --click_ads=noClick
```

Pages will be stored in the `page` table in the database, and the
`scraped_pages` directory in the output directory. The crawler saves the
main HTML document, a full-page screenshot, and an MHTML snapshot, which
you can open offline in Chrome.

### Collecting ad URLs and landing pages

You can also collect data on the landing pages of ads, using the `--click_ads`
option. There are three possible values:

- `noClick` is the default value. When set to this, ads are not clicked and no
data on the landing page or URL is collected.

- `clickAndBlockLoad` will tell the crawler to click on each ad, to find the
initial ad URL (e.g. `https://www.googleadservices.com/pagead/aclk?...`),
but it will prevent the navigation request from loading.
The URL will be stored in the `url` column in the `ad` table. \
\
This option lets you collect the URL without actually visiting the ad,
and potentially biasing your browsing profile, or causing it to be recorded as
a click by the ad networks. However, it also means that you do not necessarily
see the actual landing page
URL, which may be several steps further in a redirect chain.

- `clickAndScrapeLandingPage` will tell the crawler to click on each ad, load
the landing page, and the scrape the content of the landing page. The initial
ad url will be stored in the `url` column in the `ad` table, and the landing page
url will be stored in the `url` column of the `page` table, and that page will
have a reference to the ad it was linked from in the `referrer_ad` column.\
\
This option gives you the content of the landing page and it's URL. However,
it does mean that your browsing profile will be biased by this ad click.
Additionally, consider that this is recorded as a real ad engagement, which
may cause your crawler be flagged as a bot for performing fraudulent clicks.

### Using profiles

You can specify the browsing profile used by the crawler, using the
`---profile_dir` option. This directly sets the `--user_data_dir` option
for Chromium, which is the folder Chrome uses to store persistent storage, like
cookies and history. If no profile is specified, it will create a temporary
profile in `/tmp`. If the folder specified does not exist, it will be automatically
created.

Warning: if the browser crashes during a crawl, it may corrupt the profile
directory.

### Advanced example: collecting ads and landing pages in separate profiles

The `--profile_dir` and `--click_ads` options can be used in conjunction
to collect landing page data without biasing the profile that the ads
are collected from by clicking on the ads.

First, crawl your crawl list using `--click_ads clickAndBlockLoad`. This
gets the URLs of the ads without loading them.

```sh
node gen/crawler-cli.js \
    --name ad_crawl \
    --profile_dir /path/to/ad_scraping/profile
    --output_dir /path/to/your/output/dir \
    --crawl_list /path/to/your/crawl/list \
    --pg_conf_file /path/to/your/postgres/config \
    --scrape_ads \
    --click_ads=clickAndBlockLoad
```

Then, get a list of ad URLs using a SQL query:

```sql
\copy (SELECT id AS ad_id, url FROM ad WHERE ad.crawl_id=<crawl_id> AND url IS NOT NULL) to ad_urls.csv csv header;
```

This returns a CSV with the columns ad_id and url. This can be used as a crawl
list using the special option, `--crawl_list_with_referrer_ads`. This associates
each URL in the crawl list as the landing page for the given ad id, so the
landing page screenshots will be stored in the same folder as the ad, and the
database entries for the landing pages will have the correct referrer ad.

So using `ad_urls.csv`, run a second crawl with a different profile, and
with `--scrape_site` to capture the landing page content, and `--crawl_list_with_referrer_ads`
instead of `--crawl_list`.

```sh
node gen/crawler-cli.js \
    --name example_crawl_name \
    --profile_dir /path/to/landing_page_scraping/profile
    --output_dir /path/to/your/output/dir \
    --crawl_list_with_referrer_ads /path/to/ad_urls.csv \
    --pg_conf_file /path/to/your/postgres/config \
    --scrape_site \
    --click_ads=noClick
```

### Resuming a failed crawl

If the crawl terminates unexpectedly for some reason, you can resume the crawl
where it left off, by adding the `--crawl_id` flag, with the id of the crawl
in the database. The crawler records how much progress was made in the
crawl list, and will pick up where it left off. You must provide the same
crawl list with the same filename and length.

You can find the id of the crawl by querying the `crawl` table in Postgres.

```SQL
SELECT * FROM crawl;
```

```sh
node gen/crawler-cli.js \
    --crawl_id 24
    --name example_crawl_name \
    --output_dir /path/to/your/output/dir \
    --crawl_list /path/to/your/crawl/list \
    --pg_conf_file /path/to/your/postgres/config \
    --scrape_ads \
    --scrape_site \
    --click_ads=noClick
```

### Other command line options

For documentation of other command line options, use the `--help` option.

```sh
node gen/crawler-cli.js --help
```

<!-- ## Parallel crawls with `crawl-coordinator`

Using `crawl-coordinator`, you can orchestrate a job with parallel crawler
instances. You can set up parallel profile-based crawls, where each
instance has a separate profile and separate crawl list, or totally isolated
crawls, where each item in the crawl list is visited by a fresh profile.
`crawl-coordinator` automatically creates a queue of crawls and runs as many
parallel workers as you specify.

`crawl-coordinator` is currently undergoing a rewrite, and will be made
available in a future release. -->

<!--
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
  --inputs ../input_sites.csv \
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
  --pg_conf_file ../pg_conf.json \
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
make this available as a npm library. -->
