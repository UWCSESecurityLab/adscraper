# Crawler script documentation

This README contains documentation for the crawler script, which
can be used to run individual crawls from the command line (or as a library).

To run multiple crawls in parallel, or to run crawls on a cluster, see the
[crawl-cluster documentation](../crawl-cluster/README.md).

## Setup

### Prerequisites

To run Adscraper, you must have the following software installed:

- Node.js
- PostgreSQL

### Installation

**Get the source code**.
First, clone this repository.

```sh
git clone https://github.com/UWCSESecurityLab/adscraper.git
```

**Install Node.js dependencies.** Run the following commands to
install the crawler's dependencies.
The necessary build dependencies (Typescript, namely) are included.

```sh
cd adscraper/crawler
npm install
npm run build
```

**Set up the database.**
Metadata from crawls is stored in a Postgres database. You must first set up your
own Postgres server. There are great guides on setting up postgres online:

- [PostgreSQL official documentation](https://www.postgresql.org/)
- [Postgres.app (MacOS)](https://postgresapp.com/)
- [Postgres official Docker image](https://hub.docker.com/_/postgres)

There are no special requirements for configuring the Postgres server, as long
as the Node.js crawler process can connect to it. You can either set it up
to use Unix sockets or TCP/IP. The username, password, and database name
are all configurable in the JSON config file (see below).

To create the tables, you
can either copy the code from [adscraper.sql](adscraper.sql) into the `psql`
command line, or run the following command in your terminal:

```sh
psql -U <YOUR_POSTGRES_USERNAME> -f ./adscraper.sql
```

**Database credentials.**
Then, create a JSON file containing the authentication
credentials for your Postgres server. The format of the JSON file is the
[config file used by node-postgres](https://node-postgres.com/apis/client#new-client).
For example, you might create a file called `pg_conf.json` that looks like:

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
│  │  │  ├─ ad_<ad_id>.webp
│  │  │  ├─ ad_<ad_id>_landing_page_screenshot.webp
│  │  │  ├─ ad_<ad_id>_landing_page_content.html
│  │  │  ├─ ad_<ad_id>_landing_page_snapshot.mhtml
│  ├─ scraped_pages/
│  │  ├─ <url_escaped>/
│  │  │  ├─ <uuid>_screenshot.webp
│  │  │  ├─ <uuid>_document.html
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

## Viewing crawl results

The outputs of the crawl will be stored in the Postgres database and the
output directory specified in the command line options (`--output_dir`).

The database contains metadata for the crawls: profiles, pages, ads, and
third party requests. See [adscraper.sql](../adscraper.sql)
for the schema of the database. You can use SQL queries to extract the data into
a CSV file, and then analyze the data in Pandas, R, or whatever tool you prefer.
The database also contains references to the path of the screenshot and HTML files
for each page and ad (relative to the original output directory).

## Customizing the crawler

Depending on your use case, you may want to implement functionality
that is not currently supported by the crawler. At the moment, Adscraper
has not been built to be extensible, but you are welcome to fork the project
and modify the code to suit your needs. Here are a few key files
in the source code:

- `src/crawler.ts`: This file launches the crawler and contains the main crawl loop logic.
- `src/ads/ad-scraper.ts`: This file is the entry point for
functionality related to scraping ads; functions here are invoked on every page.
- `src/ads/click.ts`: This file contains the logic for clicking on ads, and handles blocking of page loads.
- `src/pages/page-scraper.ts`: This file is the entry point for
  functionality related to scraping pages, functions here are invoked on every page.
- `src/pages/find-page.ts`: This file contains strategies
  dynamically crawling pages that are not in the crawl list.
- `src/util/db.ts`: The file contains the API for reading from and writing to the database.


## Command Line Options

These are all of the available command line options for the
CLI interface of the crawler (`src/crawler-cli.js`). These can
also be passed in as arguments to the `crawl()` function in
`src/crawler.ts`, if you are using the crawler as a library.

### Main Options

| Name              | Alias | Type     | Description                                                                                     |
|--------------------|-------|----------|-------------------------------------------------------------------------------------------------|
| `--help`          | `-h`  | Boolean  | Display this usage guide.                                                                       |
| `--output_dir`    |       | String   | Directory where screenshot, HTML, and MHTML files will be saved. A new subdirectory will be automatically created with the name or id of the crawl.                              |
| `--name`          |       | String   | Name of this crawl (optional).                                                                 |
| `--job_id`        | `-j`  | Number   | ID of the job that is managing this crawl (Optional, required if run via Kubernetes job).       |
| `--resume_if_able`|       | Boolean  | If included, attempts to resume any previous incomplete crawl with the same name.              |
| `--log_level`     |       | String   | Sets the level of logging verbosity. Options: `error`, `warning`, `info`, `debug`, `verbose`. Defaults to `info`. |

### Input Options

| Name                  | Alias | Type     | Description                                                                                     |
|------------------------|-------|----------|-------------------------------------------------------------------------------------------------|
| `--crawl_list`         |       | String   | A text file containing URLs to crawl, one URL per line.                                         |
| `--ad_url_crawl_list`  |       | String   | A CSV with columns `(url, ad_id)` for URLs to crawl and their associated ad IDs.               |
| `--url`                |       | String   | A single URL to crawl. Use instead of `--crawl_list` to crawl one URL at a time.               |
| `--ad_id`              |       | String   | Specify the ad ID for a single URL crawl associated with an ad landing page.                   |

### Database Configuration

| Name            | Alias | Type     | Description                                                                                     |
|------------------|-------|----------|-------------------------------------------------------------------------------------------------|
| `--pg_conf_file` |       | String   | JSON file with Postgres connection parameters: `host`, `port`, `database`, `user`, `password`.  |
| `--pg_host`      |       | String   | Hostname of the Postgres instance (Default: `localhost`).                                       |
| `--pg_port`      |       | Number   | Port of the Postgres instance (Default: `5432`).                                               |
| `--pg_database`  |       | String   | Name of the Postgres database (Default: `adscraper`).                                          |
| `--pg_user`      |       | String   | Name of the Postgres user.                                                                     |
| `--pg_password`  |       | String   | Password for the Postgres user.                                                                |

### Puppeteer Options

| Name               | Alias | Type     | Description                                                                                     |
|---------------------|-------|----------|-------------------------------------------------------------------------------------------------|
| `--headless`        |       | String   | Puppeteer headless mode: `true`, `false`, or `shell` (Default: `true`).                        |
| `--profile_dir`     |       | String   | Directory of the profile (user data directory) for Puppeteer.                                  |
| `--executable_path` |       | String   | Path to the Chrome executable for this crawl.                                                  |
| `--proxy_server`    |       | String   | Proxy server for Chrome traffic.                                                              |

### Crawl Options

| Name                   | Alias | Type     | Description                                                                                     |
|-------------------------|-------|----------|-------------------------------------------------------------------------------------------------|
| `--shuffle_crawl_list` |       | Boolean  | Randomize the order of URLs in the crawl list.                                                 |
| `--crawl_article`       |       | Boolean  | Crawl in article mode: crawl the home page and the first article in the site's RSS feed.       |
| `--crawl_page_with_ads` |       | Number   | Crawl additional pages with ads. Specify the number of additional pages to visit.             |
| `--refresh_pages`       |       | Boolean  | Refresh each page after scraping and scrape it a second time (Default: `false`).              |

### Scrape Options

| Name                             | Alias | Type     | Description                                                                                     |
|-----------------------------------|-------|----------|-------------------------------------------------------------------------------------------------|
| `--scrape_site`                  |       | Boolean  | Scrape the content of the sites in the crawl list.                                             |
| `--scrape_ads`                   |       | Boolean  | Scrape the content of ads on the sites in the crawl list.                                      |
| `--capture_third_party_request_urls` |    | Boolean  | Capture URLs of third-party requests made by websites.                                         |
| `--click_ads`                    |       | String   | Specify ad-click behavior: `noClick`, `clickAndBlockLoad`, or `clickAndScrapeLandingPage`. Default: `noClick`. |
| `--screenshot_ads_with_context`  |       | Boolean  | Include a 150px margin around ads in screenshots for context (Default: `false`).              |