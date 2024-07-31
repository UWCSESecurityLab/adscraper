# adscraper: A Web Crawler for Measuring Online Ad Content

**adscraper** is a tool for scraping online ads. Given a website (or a list of
websites), it opens the website in a Chromium browser, and takes a screenshot
and saves the HTML content of each ad on the page.

- [adscraper: A Web Crawler for Measuring Online Ad Content](#adscraper-a-web-crawler-for-measuring-online-ad-content)
  - [Introduction](#introduction)
    - [Research using adscraper](#research-using-adscraper)
    - [Warning: Research Code!](#warning-research-code)
    - [Citations](#citations)
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
  - [Running distributed crawls](#running-distributed-crawls)

## Introduction

Adscraper is a Node.js script that uses the
[puppeteer](https://github.com/puppeteer/puppeteer) library to automatically
browse and collect ad data. You can use the crawler via the command line to
crawl a single site, or you can use it as part of your own Node.JS script.

The adscraper **crawl-cluster** uses Kubernetes to orchestrate
crawls across multiple crawler instances. This allows multiple crawls to be
queued and run in parallel across multiple nodes in a Kubernetes cluster.
This useful if you plan to run many crawls across different browsing profiles.

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

### Citations
If you used adscraper in your research project, please cite the repository
using the following BibTeX:

```bibtex
@software{Eric_Zeng_adscraper,
author = {Eric Zeng},
license = {MIT},
title = {{adscraper: A Web Crawler for Measuring Online Ad Content}},
url = {https://github.com/UWCSESecurityLab/adscraper}
}
```

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
[adscraper.sql](adscraper.sql). Metadata from crawls will be stored
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


## Running distributed crawls

Need to run 10s, or even 100s of crawls with different profiles? Or do you need
to parallelize crawls over thousands of URLs? The crawl-cluster directory
contains a Kubernetes-based solution for running parallel crawls, distributed
across multiple nodes.

Refer to the documentation in [crawl-cluster/README.md](crawl-cluster/README.md)
for more information.
