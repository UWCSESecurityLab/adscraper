# Adscraper: A Web Crawler for Measuring Online Ad Content

- [Adscraper: A Web Crawler for Measuring Online Ad Content](#adscraper-a-web-crawler-for-measuring-online-ad-content)
  - [About Adscraper](#about-adscraper)
    - [Research using Adscraper](#research-using-adscraper)
    - [Citations](#citations)
    - [Warning: Research Code!](#warning-research-code)
  - [Quick Start (basic crawls)](#quick-start-basic-crawls)
    - [Pre-requisites](#pre-requisites)
    - [Installation](#installation)
    - [Creating a crawl list](#creating-a-crawl-list)
    - [Running crawls](#running-crawls)
    - [Detailed instructions and advanced usage](#detailed-instructions-and-advanced-usage)
  - [Quick Start (distributed crawls)](#quick-start-distributed-crawls)
    - [Pre-requisites](#pre-requisites-1)
    - [Creating input files](#creating-input-files)
    - [Running a crawl](#running-a-crawl)
    - [Detailed instructions and advanced usage](#detailed-instructions-and-advanced-usage-1)
  - [Viewing and analyzing data](#viewing-and-analyzing-data)
  - [Acknowledgements](#acknowledgements)

## About Adscraper

Adscraper is an open source research tool for automatically
scraping the content of ads on the web.
Given a list of URLs, Adscraper visits each URL in a Chromium browser,
and can collect the following data about the ads that appear of the page:

- Screenshots of ads
- Ad URLs
- Ad landing pages
- Third-party tracking requests


The core Adscraper crawler is a Node.js script, powered by [Puppeteer](https://github.com/puppeteer/puppeteer),
a browser automation library for the Chromium browser.
You can run a small number
of crawlers using this script directly.
For bigger experiments, you can run many parallel crawler
instances, distributed across multiple workers,
using the **crawl-cluster** tool, which runs Adscraper as a Kubernetes Job workload.

### Research using Adscraper

Adscraper has been used to conduct research measuring and auditing the online
ads ecosystem. You can read about some of the projects that used Adscraper below:

- [(Paper) Analyzing the (In)Accessibility of Online Advertisements](https://dl.acm.org/doi/10.1145/3646547.3688427)
- [(Paper) Polls, Clickbait, and Commemorative $2 Bills: Problematic Political Advertising on News and Media Websites Around the 2020 U.S. Elections](https://badads.cs.washington.edu/political.html)
- [(Project website) Bad Ads: Problematic Content in Online Advertising](https://badads.cs.washington.edu)
- [(Paper) What Makes a "Bad" Ad? User Perceptions of Problematic Online Advertising](https://badads.cs.washington.edu/files/Zeng-CHI2021-BadAds.pdf)
- [(Paper) Bad News: Clickbait and Deceptive Ads on News and Misinformation Websites](https://badads.cs.washington.edu/files/Zeng-ConPro2020-BadNews.pdf)

### Citations

If you used Adscraper in your research project, please cite the repository
using the following BibTeX:

```bibtex
@software{Zeng_adscraper,
  author = {Eric Zeng},
  license = {MIT},
  title = {Adscraper: A Web Crawler for Measuring Online Ad Content},
  url = {https://github.com/UWCSESecurityLab/adscraper},
  version = {1.0.0},
  date = {YYYY-MM-DD}
}
```

### Warning: Research Code!

Adscraper is a research tool, and may contain bugs!
If you are running into issues with the code or documentation, please let us
know by filing an issue or asking a question in the discussions. I will also
accept pull requests for fixing bugs, doc bugs, or making the project more
generally usable and configurable.

## Quick Start (basic crawls)

Here are instructions for running a basic crawl using a single Adscraper instance. More detailed documentation can be found in
**[crawler/README.md](crawler/README.md)**.

### Pre-requisites

To run Adscraper, you must have the following software installed:

- Node.js
- PostgreSQL

### Installation

First, clone the project, install dependencies, and build the project:

```sh
git clone https://github.com/UWCSESecurityLab/adscraper.git
cd adscraper/crawler
npm install
npm run build
```

Then, create tables in the Postgres database to store the metadata from the crawls.

```sh
cd ../..
psql -U <YOUR_POSTGRES_USERNAME> -f ./adscraper.sql
```

Lastly, create a JSON file named `pg_conf.json` containing the authentication credentials for your Postgres database.

```json
{
  "host": "localhost",
  "port": 5432,
  "database": "adscraper",
  "user": "<your postgres username>",
  "password": "<your postgres password>"
}
```

### Creating a crawl list

Next, create a **crawl list** - the URLs that the crawler will visit.
The format is a text file containing one URL per line. For example, a crawl list named `crawl_list.txt` might look like:

```txt
https://www.nytimes.com/
https://www.cnn.com/
https://www.espn.com/
https://www.stackoverflow.com/
```

### Running crawls

From the `crawler/` directory, run the ``crawler-cli'' script to start the crawl.
This script will scrape the content of the ads on the pages in the crawl list,
and click on the ads to get the Ad URL, but block the ads from opening.

```sh
node gen/crawler-cli.js \
    --name my_crawl_name \
    --output_dir /path/to/your/output/dir \
    --crawl_list /path/to/your/crawl_list.txt \
    --pg_conf_file /path/to/your/pg_conf.json \
    --scrape_ads \
    --click_ads=clickAndBlockLoad
```
The data will be stored in two places:
1. Crawl metadata is stored in the Postgres database
   - e.g.. for each ad, the ad URL, the
page the ad appeared on, when the ad was crawled
2. The screenshots of ads and HTML content of pages is stored in the directory `output_dir`.
   - The location of these files are specified in the metadata for each ad and page, in the columns `ad.screenshot`, `page.screenshot`, `page.html`, etc.


### Detailed instructions and advanced usage

For detailed instructions on how to set up Adscraper, and examples of different
types of crawls you can run to answer different research questions, please read
**[crawler/README.md](crawler/README.md)**.

## Quick Start (distributed crawls)

Do you need to run tens, or even hundreds of crawls with different browser profiles?
Or do you need to parallelize crawls over thousands of URLs? The crawl-cluster tool uses Kubernetes to deploy multiple Adscraper workers to run large crawl jobs.

crawl-cluster is a script that takes a JSON crawl specification file as input,
and automatically generates and launches a Kubernetes Job, which automatically
deploys Adscraper crawler instances to a Kubernetes cluster.

The following instructions will help you set up the crawl-cluster
infrastructure. For detailed documentation, please refer to
**[crawl-cluster/README.md](crawl-cluster/README.md)**.

### Pre-requisites

To run a Adscraper cluster, you must run the following services:

- Kubernetes on each node (Recommended distribution: [k3s](https://k3s.io/))
- A PostgreSQL database server, set up as described in the basic crawl instructions
- A distributed file system or server (e.g. NFS, SMB/CIFS)

### Creating input files

Distributed crawls are configured using a JSON file, that specifies the
crawler options, as well as the profiles and URLs to crawl.

For example, let's say you wanted to crawl ads shown to two hypothetical browsing profiles:
one for a user interested in sports and another for a user interested in cooking.

First, create the _crawl lists_ for each profile:

**sports_crawl_list.txt**:

```txt
https://www.espn.com
https://www.nba.com
https://www.mlb.com
```

**cooking_crawl_list.txt**:

```txt
https://www.seriouseats.com
https://www.foodnetwork.com
https://www.allrecipes.com
```

Then, you can create a _job specification_, that specifies the crawler behavior,
and which profiles and crawl lists to use:

**example-job.json**:

```json
{
  "jobName": "example-crawl",
  "dataDir": "/home/pptruser/data",
  "maxWorkers": 2,
  "profileOptions": {
    "useExistingProfile": false,
    "writeProfileAfterCrawl": true
  },
  "crawlOptions": {
    "shuffleCrawlList": false,
    "findAndCrawlPageWithAds": 0,
    "findAndCrawlArticlePage": false
  },
  "scrapeOptions": {
    "scrapeSite": false,
    "scrapeAds": true,
    "clickAds": "clickAndBlockLoad",
    "captureThirdPartyRequests": true
  },
  "profileCrawlLists": [
    {
      "crawlName": "profile_crawl_sports",
      "crawlListFile": "/home/pptruser/data/inputs/example-job/sports_crawl_list.txt",
      "crawlListHasReferrerAds": false,
      "profileDir": "/home/pptruser/data/profiles/sports_profile"
    },
    {
      "crawlName": "profile_crawl_cooking",
      "crawlListFile": "/home/pptruser/data/inputs/example-job/cooking_crawl_list.txt",
      "crawlListHasReferrerAds": false,
      "profileDir": "/home/pptruser/data/profiles/cooking_profile"
    },
  ]
}
```

Place these input files in a folder on the distributed file system, so that they
can be read by the Kubernetes workers.

### Running a crawl

To start the job, run the `runIndexedJob.js` script:

```sh
cd adscraper/crawl-cluster/cli
npm install
npm run build

node gen/runIndexedJob.js -j /path/to/your/example-job.json -p /path/to/your/pg_conf.json
```

To monitor the progress of the job, you can use the `kubectl` command to view
the status of the crawl worker containers:

```sh
# To view overall job progress
kubectl describe job <job-name>

# To view statuses of each crawl instance
kubectl get pods -o wide -l job-name=<job-name>

# View active crawl instances
kubectl get pods -o wide --field-selector status.phase=Running

# To view the logs of a specific crawler (for debugging)
kubectl logs <pod-name>
```

Like in the basic crawl, the data is stored in two places:

1. Crawl metadata is stored in the PostgreSQL database
2. The screenshots of ads and HTML content of pages is stored in the directory `dataDir`,
   which is a location in the distributed file system.

### Detailed instructions and advanced usage

For full instructions on setting up the cluster and running crawls
refer to the documentation in **[crawl-cluster/README.md](crawl-cluster/README.md)**.



## Viewing and analyzing data

Though there is no built-in tool for analyzing crawl data, you can use SQL queries
to export the data from the Postgres database, and use your favorite data
analysis tool, like Pandas or R, to analyze the data.

For example, for the example crawl above, you can run the following
commands in PSQL to export CSVs containing the metadata for the ads and their parent pages:

```sql
\copy(SELECT page.id as page_id, crawl_id, url, original_url FROM page JOIN crawl ON page.crawl_id = crawl.id WHERE crawl.name = 'my_crawl_name') to 'ads.csv' csv header;

\copy(SELECT ad.id as ad_id, crawl_id, parent_page, url as ad_url, screenshot FROM ad JOIN crawl ON ad.crawl_id = crawl.id WHERE crawl.name = 'my_crawl_name') to 'pages.csv' csv header;
```

Then, in pandas, you can read and analyze the metadata yourself:

```python
import pandas as pd

# Read CSVs
ads = pd.read_csv('ads.csv')
pages = pd.read_csv('pages.csv')

# Merge ad and page tables
df = pd.merge(ads, pages, left_on='parent_page', right_on='page_id')

# Count ads per parent page
print(df['url'].value_counts())

# Count most popular ad URL domains
import urllib.parse
print(df['ad_url'] \
  .apply(lambda x: urllib.parse.urlparse(x).netloc) \
  .value_counts())
```

To answer more complex research questions about the content of ads, you will
likely need to label the ads. This is beyond the scope of this project, but
in past research projects, we've used tools and methods like:

- Manually labeling ad screenshots and landing pages using [Label Studio](https://labelstud.io/)
- Using OCR to extract text from ad screenshots, and using NLP tools like
  text classifiers, topic models, and LLMs to identify topics
- Scraping the landing pages of ads, and using NLP tools to identify topics

## Acknowledgements

Adscraper was developed by Eric Zeng
at the University of Washington
and Carnegie Mellon University.

This project was supported in part by the National Science Foundation under Awards CNS-1565252, CNS-1651230, and CNS-2041894;
the U.S. Army Research Office under MURI grant W911NF-21-1-0317;
the Penn Medical Communications Research Institute;
the UW Center for Informed Public;
the John S. and James L. Knight Foundation;
and the UW Tech Policy Lab, which receives support from: the
William and Flora Hewlett Foundation, the John D. and Catherine T.
MacArthur Foundation, Microsoft, the Pierre and Pamela Omidyar
Fund at the Silicon Valley Community Foundation.
