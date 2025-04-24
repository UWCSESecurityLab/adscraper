# Adscraper Distributed Crawls

This directory contains code and configuration for running parallel crawls with
adscraper, using Kubernetes. To do so, you define a JSON
_job specification_ in a JSON file,
where you specify the multiple crawls you would like to run. A script takes
this as input and converts it to a Kubernetes indexed job, and Kubernetes
will handle automatically scheduling and executing your crawls in parallel.

The adscraper distributed crawl architecture enables several types of crawls,
depending on your experimental design:

- **Profile-based crawls**, where each you can build a separate browsing profile
  for each crawler instance. This is useful for simulating users and how they
  are tracked or targeted based on their web history.
- **Isolated crawls**, where each URL is crawled with a clean profile. This is
  useful for studying contextual ad targeting.
- **Ad landing page crawls** - given a list of ad URLs retrieved from a previous
  crawl (using the `clickAndBlockLoad` ad scraping strategy in adscraper),
  you can crawl the landing pages and associate them with those previous
  ads. This is useful for collecting ad landing page content without biasing
  profile-based crawls.

There are also some other useful features built-in to make web measurement
research easier, such as:

- Support for SOCKS5 proxies, to simulate users from different IPs and locations
- Checkpointing and retrying crawls, in case long crawls fail

The crawl cluster is designed to be run on a Kubernetes cluster to scale crawls
over multiple nodes (a control plane node and several worker nodes).
Additionally, you will need to run other
services to enable the cluster to run, including a PostgreSQL database and
a network storage volume to store scraped data.
If you do not need to run more than a few crawl jobs, consider using the
base adscraper script.

**Table of Contents**
- [Adscraper Distributed Crawls](#adscraper-distributed-crawls)
  - [Pre-requisites](#pre-requisites)
  - [Setup](#setup)
    - [1. Installing Kubernetes](#1-installing-kubernetes)
    - [2. Setting up a network storage volume](#2-setting-up-a-network-storage-volume)
    - [3. Set up a Postgres database](#3-set-up-a-postgres-database)
    - [4. Set up the network policy for crawler pods](#4-set-up-the-network-policy-for-crawler-pods)
  - [Usage](#usage)
    - [Creating crawler inputs](#creating-crawler-inputs)
      - [Crawl Lists](#crawl-lists)
      - [Job Specification File](#job-specification-file)
      - [Example job specifications](#example-job-specifications)
    - [Running crawl jobs](#running-crawl-jobs)
    - [Monitoring crawl jobs](#monitoring-crawl-jobs)
    - [Viewing crawl results](#viewing-crawl-results)
  - [Performance Notes](#performance-notes)

## Pre-requisites

Adscraper distributed crawls require the following software to be installed:

On the Kubernetes control plane node (the server that coordinates the cluster):

- Node.js
- Kubernetes (Recommended: [k3s server](https://k3s.io/))

On worker nodes:

- Kubernetes (Recommended: [k3s agent](https://k3s.io/))

On the database server:

- PostgreSQL

## Setup


### 1. Installing Kubernetes
First, you will need to set up a Kubernetes cluster, which will manage the
crawl jobs, as well as database and storage services, for collecting crawl data.

Start by setting up Kubernetes on each node:
   - Follow the [k3s quickstart guide](https://docs.k3s.io/quick-start)
     for instructions on setting up a k3s cluster.
   - Ideally: set up a separate control plane node, and worker nodes for the
     crawlers. This is not strictly necessary, but can prevent the crawlers
     from taking down the cluster if they consume too many resources.
   - On your control plane node, indicate which nodes are valid workers by running
     the following command for each worker node:

```sh
kubectl label node <worker-node-name> crawler=true
```
### 2. Setting up a network storage volume
The crawl cluster needs a shared storage volume that all crawler instances
can access, so that they can read input files, and write scraped ad data
to the same location.

- If you are running on a single node, you can designate a directory on
  your machine as a [hostPath](https://kubernetes.io/docs/concepts/storage/volumes/#hostpath)
  volume.
- If you are running on multiple nodes, you will need to set up a network
  storage volume. Refer to the [Kubernetes documentation](https://kubernetes.io/docs/concepts/storage/volumes)
  for setting up volumes and drivers.
- Once you have set up your local or network storage volume,
  to register your volume with adscraper, edit
  [config/indexed-job.yaml](config/indexed-job.yaml)
  and add your volume to `.spec.template.spec.volumes`,
  using the name `adscraper-storage`.

For example, for a CIFS volume, you would add the following to `.spec.template.spec.volumes`:

```yaml
      volumes:
        - name: adscraper-storage
          flexVolume:
            driver: "fstab/cifs"
            fsType: "cifs"
            secretRef:
              name: "cifs-secret"
            options:
              networkPath: "//example.com/adscraper-storage"
              mountOptions: "uid=999,gid=999,dir_mode=0777,file_mode=0777"
```

And then under `.spec.template.spec.containers.volumeMounts`, add the following:

```yaml
      volumeMounts:
        - name: adscraper-storage
          mountPath: /home/pptruser/data
```

It is recommended to mount the volume to `/home/pptruser/data`, because
`pptruser` is the user that runs the crawler in the container, and the
permissions are set up to allow this user to write to the directory.

You can use any volume type that is supported by Kubernetes, including NFS,
CIFS, or any other network storage solution.
You can read more about setting up volumes in the [Kubernetes documentation](https://kubernetes.io/docs/concepts/storage/volumes/).


### 3. Set up a Postgres database

Postgres is used to store metadata about the crawls. The server
can run anywhere as long as it is accessible to the
Kubernetes cluster (no firewalls in the way).
I have run the database on the control plane node, as a standalone service
(not in a Kubernetes pod), but in theory you can run it in Kubernetes if you prefer.

After you have set up a Postgres server, follow these steps:
  - Run the queries to create the database, tables, and indexes in [adscraper.sql](../adscraper.sql)
  - Edit [config/postgres-service.yaml](config/postgres-service.yaml), and replace
    the `externalName` field with the address of your database,
    and the `ports` field with the ports of your database. This should be the
    external IP or hostname of your database server.
  - Set up the database secrets so that adscraper can access the database:
    Edit [config/pg-conf-secret.yaml](config/pg-conf-secret.yaml) and replace
    the `data` fields with the base64-encoded values of your database, user,
    and password. You can use the `echo -n 'password' | base64` command to
    encode your values.
  - Apply the Service and Secret configs:

```sh
kubectl apply -f config/postgres-service.yaml
kubectl apply -f config/postgres-secret.yaml
```

### 4. Set up the network policy for crawler pods
Next, we need to set up the Kubernetes network policy to allow Adscraper
containers to access the internet. This changes the network policy to allow
egress traffic.

```sh
kubectl apply -f config/network-policy.yaml
```

## Usage

Next, we will cover how to set up and run a crawl job.

### Creating crawler inputs

First, create input files to define your crawl jobs. Each crawl job contains
two components:

- Crawl lists: one or more text files containing a list of URLs to crawl
- Job specification: a JSON file that specifies which crawl lists are to be used,
  and configuration options for crawler behavior and profile handling.

#### Crawl Lists

Crawl lists are text files containing a list of URLs to crawl. Each URL should
be on a separate line. If you are crawling with multiple profiles, each profile's
crawl list should be in a separate file.

For example, if you had two profiles, one for a user interested in sports and
another for a user interested in cooking, you would have two crawl lists:

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

These text files **must** be stored in the storage volume for the cluster,
as the crawler instances need to be able to read them from disk.

#### Job Specification File

In the job specification file is a JSON file. In this file, you will specify
the crawl lists to use, and configure the behavior of the crawlers.

[src/jobSpec.ts](src/jobSpec.ts) contains the TypeScript interface for the
job specification file. Below is a summary of the fields in the job specification.


**JobSpec**

This is the entry point for the job specification file. Here, you can specify
the job name, output directories, and amount of parallelism. Additionally,
you can specify one of three types of crawls:

- Isolated crawls: provide a single crawl list file to `crawl_list`. Each URL will be crawled with a clean profile (i.e., a new container will be created to crawl each URL, and then destroyed).

- Profile-based crawls: provide multiple crawl list files, one for each profile,
  to `profileCrawlLists`. Each profile will be crawled with a separate browsing
  profile that will keep state between crawls. The profiles will be stored in the output directory afterwards.

- Ad landing page crawls: provide a CSV file with columns `ad_id` and `url` to `adUrlCrawlList`. Each URL will be crawled with a clean profile, and the collected data
  will be associated with an ad_id from a previous crawl.


Notes on directories:

- `hostDataDir` refers to the path of the output directory on the host.
  Specifically, the Node.js script that starts the crawl job must be able to
  reference this path. For example, if you mounted a network volume at `/mnt/data`,
  you would set `hostDataDir` to `/mnt/data`.

- `containerDataDir` refers to the location in the container where the output
directory is mounted. This is the path that you specify in the volumeMounts
field when modifying [config/indexed-job.yaml](config/indexed-job.yaml) (see previous instructions in Setup). The recommended directory is `/home/pptruser/data`, because
`pptruser` is the user that runs the crawler in the container.

| Name                  | Type                | Description                                                                                     |
|-----------------------|---------------------|-------------------------------------------------------------------------------------------------|
| `jobName`             | `string`           | Unique name for your job. If this job exists in the database, it resumes a crashed job.         |
| `hostDataDir`         | `string`           | Directory on the host where screenshots, logs, and scraped content should be stored.           |
| `containerDataDir`    | `string`           | Directory where `hostDataDir` is mounted in the container.                                      |
| `maxWorkers`          | `number`           | Maximum number of Chromium instances to run in parallel.                                       |
| `nodeName`            | `string` (optional)| Kubernetes node name where workers are restricted to.                                           |
| `crawlList`           | `string` (optional)| Path to a file containing URLs to crawl, one per line.                                          |
| `adUrlCrawlList`      | `string` (optional)| CSV file with columns `ad_id` and `url` for crawling ad URLs.                                   |
| `profileCrawlLists`   | `ProfileCrawlList[]` (optional) | Array of profile crawl list specifications.                                                   |
| `profileOptions`      | `ProfileOptions`   | Configuration options for Chrome profiles.                                                     |
| `crawlOptions`        | `CrawlOptions`     | Options for crawling behavior.                                                                 |
| `scrapeOptions`       | `ScrapeOptions`    | Options for scraping behavior.                                                                 |

---

**ProfileOptions**

Configuration options for handling profiles. You can specify whether to use
profiles, whether to save them after the crawl or not, whether to save
profile checkpoints for long-running crawls (to recover from crawls that crash),
and whether to use a SOCKS proxy server for all profiles. If you want to
use a SOCKS proxy server for individual profiles, you can specify it in the
`ProfileCrawlList` section.

| Name                       | Type                | Description                                                                                     |
|----------------------------|---------------------|-------------------------------------------------------------------------------------------------|
| `useExistingProfile`       | `boolean` (optional)| Whether to use an existing Chrome profile.                                                     |
| `writeProfileAfterCrawl`   | `boolean` (optional)| Whether to save the profile after the crawl is complete.                                        |
| `compressProfileBeforeWrite` | `boolean` (optional)| Whether to compress the profile before saving it.                                              |
| `profileCheckpointFreq`    | `number` (optional) | Frequency (in seconds) for saving profile checkpoints during a crawl.                          |
| `proxyServer`              | `string` (optional) | SOCKS proxy server URL for all profiles/crawls in this job.                                     |
| `sshHost`                  | `string` (optional) | SSH host for creating a tunnel.                                                                |
| `sshRemotePort`            | `number` (optional) | SSH remote port for creating a tunnel.                                                         |
| `sshKey`                   | `string` (optional) | File location of the SSH private key (within the container).                                    |

---

**CrawlOptions**

| Name                       | Type      | Description                                                                                     |
|----------------------------|-----------|-------------------------------------------------------------------------------------------------|
| `shuffleCrawlList`         | `boolean` | Whether to randomize the order of URLs in the crawl list.                                       |
| `findAndCrawlPageWithAds`  | `number`  | Number of additional pages with ads to crawl.                                                  |
| `findAndCrawlArticlePage`  | `boolean` | Whether to crawl an article page linked from the RSS feed or heuristically identified.          |
| `refreshPage`              | `boolean` | Whether to refresh each page after scraping and scrape it again.                                |

---

**ScrapeOptions**

Configuration options for scraping behavior. Here, you can specify what
kinds of data to scrape (i.e. ads, pages, third-party requests).

| Name                       | Type                | Description                                                                                     |
|----------------------------|---------------------|-------------------------------------------------------------------------------------------------|
| `scrapeSite`               | `boolean`          | Whether to scrape the page content (screenshot, HTML, MHTML).                                   |
| `scrapeAds`                | `boolean`          | Whether to scrape the ads on the page (screenshot, HTML).                                       |
| `clickAds`                 | `'noClick' | 'clickAndBlockLoad' | 'clickAndScrapeLandingPage'` | Behavior for clicking ads. |
| `captureThirdPartyRequests`| `boolean`          | Whether to capture third-party network requests for tracking detection.                         |
| `screenshotAdsWithContext` | `boolean`          | Whether to include a 150px margin around ads in screenshots for context.                        |

---

**ProfileCrawlList**

This is the interface for specifying a single profile's crawl list and
crawling configuration. In the full specification file, you will have an array
of these objects.

Here, you specify the crawl list used, the profile name, where the browsing
profile is stored, and whether to use a SOCKS proxy server.

When specifying the crawl list, you can either specify a single URL to crawl,
using the `url` field, or a file containing a list of URLs to crawl,
using the `crawlListFile` field. You must specify one or the other.

| Name                  | Type                | Description                                                                                     |
|-----------------------|---------------------|-------------------------------------------------------------------------------------------------|
| `crawlName`           | `string`           | Name/label for the crawl, used to identify it in the database.                                  |
| `profileId`           | `string`           | ID for this profile, shared across multiple crawls if needed.                                   |
| `crawlListFile`       | `string` (optional)| Path to a file containing URLs to crawl.                                                       |
| `url`                 | `string` (optional)| Single URL to crawl.                                                                            |
| `profileDir`          | `string` (optional)| Directory of the Chrome user-data-dir for this crawl.                                           |
| `newProfileDir`       | `string` (optional)| Directory to save the profile after the crawl, if not overwriting the existing profile.         |
| `proxyServer`         | `string` (optional)| SOCKS proxy server URL for this profile's crawl.                                                |
| `sshHost`             | `string` (optional)| SSH host for creating a tunnel for this profile's crawl.                                        |
| `sshRemotePort`       | `number` (optional)| SSH remote port for creating a tunnel for this profile's crawl.                                 |
| `sshKey`              | `string` (optional)| File location of the SSH private key (within the container).


#### Example job specifications

You can view example job specifications in the `test` directory.

In [`test/example-job`](test/example-job), we show example specifications and crawl lists for a two-stage experiment on targeted ads.

1. [`test/example-job/profile_job.json`](test/example-job/profile_job.json): First, we run a profile creation job, where we crawl 3 crawl lists with 3 different profiles (for three interests: sports, cooking, and health).
2. [`test/example-job/target_job.json`](test/example-job/target_job.json): Then, we run a targeted ad collection job. Using the profiles created in the first job, all three profiles crawl the sites in [`target_sites.txt`](test/example-job/target_sites.txt) and collect the ads that are shown to them.

### Running crawl jobs

To run a crawl job, you will run a Node.js script on the control plane server,
which takes the crawler job specification and database credentials as input.
This will automatically create a Kubernetes indexed job, which will
schedule crawls based on available compute resources in your cluster.

From the `crawl-cluster` directory run the following commands to install
dependencies and compile the script:

```sh
cd cli

npm install
npm run build
```

Then, to run a crawl job, run the following command:

```sh
node gen/runIndexedJob.js -j <job specification file> -p <postgres credentials file>
```

The postgres credentials file is a JSON file containing connection parameters.
The full list of fields is defined in the [node-postgres library](https://node-postgres.com/apis/client).
Here is an example credentials file:

```json
{
  "host": "my-database.example.com",
  "port": 5432,
  "database": "adscraper",
  "user": "myname",
  "password": "asdf1234"
}
```

### Monitoring crawl jobs

To monitor the status of your crawl jobs, you can use the following `kubectl`
commands on the control plane server:

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

Sometimes, crawlers may hang on individual pages. In this case, you can delete
the pod and let Kubernetes restart the crawl:

```sh
kubectl delete pod <pod-name>
```

### Viewing crawl results

Outputs will be stored in the Postgres database and in the storage volume
specified in the job configuration file.

The database contains metadata for the crawls: profiles, pages, ads, and
third party requests. See [adscraper.sql](../adscraper.sql)
for the schema of the database.

The storage volume contains the raw HTML and screenshots of the pages and
ads scraped. Each job will have its own directory, with the pattern `job_<jobId>`.
The database contains a reference to the path of the screenshot and HTML files
for each page and ad, which is relative to the root of the storage volume.

## Performance Notes

Crawling with puppeteer can take many resources.
In our experience, the crawl cluster needs at least 1 CPU core and 4GB of RAM
per crawler instance. The minimum resources for each node can be specified in [config/indexed-job.yaml](config/indexed-job.yaml).

However, the main bottleneck when crawling is often disk I/O, because
Chrome constantly caches data to disk. If you plan to run many crawlers
in parallel, we recommend using SSDs.

Running with profiles further complicates the disk I/O issue. When running a
cluster, the profiles are by default stored in the shared storage volume.
This is problematic because if it is a network storage volume, it can be
slow to read and write to, especially if multiple crawlers are attempting
to read and write simultaneously. Profiles can be large - up to 5GB after
crawling many sites.

One mitigation strategy is to locally cache profiles, rather than on the network
volume. This can be done by adding a second volumeMount to the container in
[config/indexed-job.yaml](config/indexed-job.yaml), and use a hostPath volume
that points to a local directory on the worker node. This will allow for
faster reads and writes. However, you must then restrict profiles to running
on the worker node on which its profile is stored, if you reuse profiles across
crawls (i.e. a profile building crawl followed by an ad collection crawl).
This can be done by setting the `nodeName` field in the job specification
to the name of the worker node where the profile is stored.
