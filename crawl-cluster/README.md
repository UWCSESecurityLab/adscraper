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

### Setting up the cluster

First, you will need to set up a Kubernetes cluster, which will manage the
crawl jobs, as well as database and storage services, for collecting crawl data.

1. Set up Kubernetes on your nodes:
   - Follow the [k3s quickstart guide](https://docs.k3s.io/quick-start)
     for instructions on setting up a k3s cluster.
   - Ideally: set up a separate control plane node, and worker nodes for the
     crawlers
   - On your control plane node, indicate which nodes can be used to crawl by running:

```sh
kubectl label node <node-name> crawler=true
```

2. Set up a storage volume for storing inputs and outputs.
    - The crawl cluster needs a shared storage volume that all crawler instances
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

3. Set up a Postgres database (not through Kubernetes)
    - This database can run anywhere as long as it is accessible to the
      Kubernetes cluster (no firewalls in the way). I ran it on the control
      plane server.
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

1. Set up network policy to allow adscraper
   containers to access the internet. This changes the network policy to allow
   egress traffic.

```sh
kubectl apply -f config/network-policy.yaml
```

### Creating crawler inputs

Next, create input files to define your crawl jobs. Each crawl job contains
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

The job specification file is a JSON file that contains crawler configurations,
and the crawl lists that should be used.
[src/jobSpec.ts](src/jobSpec.ts) contains a TypeScript interface for the
job specification file.

TODO: describe schemas and configuration options, provide examples

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
