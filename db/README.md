# Adscraper Database
Most data collected by adscraper (excluding screenshots) is stored in a
PostgreSQL database. Each crawler instance connects to Postgres and directly
inserts new rows as it crawls.

The schema and related documentation of data formats can be found in
`adscraper.sql`.

## Setup (basic crawls)
1. Install Postgres using the method of your choice. Some suggested guides:
    - MacOS: https://postgresapp.com/
    - Ubuntu: https://www.digitalocean.com/community/tutorials/how-to-install-postgresql-on-ubuntu-20-04-quickstart
    - Windows: https://www.postgresql.org/download/windows/
    - Note: it is recommended that you set a username and password for your
      database when you set it up. Remember these credentials, as you will
      need to provide them to the crawlers.
2. Create the `adscraper` database, and run the table creation script in
`adscraper.sql`:
```sh
# Create all of the tables and indices
# If you set up your Postgres to bind to a network port, add the option
#     "-h localhost"
# If you use a custom port (default is 5432), add the option
#     "-p <YOUR_POSTGRES_PORT>"
psql -d adscraper -U <YOUR_POSTGRES_USERNAME> -f ./adscraper.sql
```

## Setup (for Docker-based crawls)
To run `crawl-coordinator`, you must set up your Postgres database in Docker,
so that the Docker-based crawl workers can connect to the database.

First, make sure you have Docker installed, and then pull the postgres image.
```sh
docker pull postgres:13
```

Next, create a file in this directory called `postgres_env`, an environmental
variables file, and insert the following entries:
```
POSTGRES_PASSWORD=insert_password_here
POSTGRES_USER=adscraper
```
These will be the credentials for your Docker postgres instance. Do not
check this file into Git!

Next, create a Docker bridge network named `adscraper`. This will allow the
crawl workers, which will also run in Docker containers, to connect to the 
Postgres container.
```
docker network create adscraper
```

Next, create a Docker volume, where the Postgres data will be stored. The data
will be persisted here outside of containers, so you can create, stop, restart,
delete, and recreate your Postgres container, without losing data, as long 
as you mount to this volume.
```
docker volume create adscraper_data
```

Next, run the following command to start a new container running Postgres,
named `adscraper-postgres`, creates a user with the credentials provided in the
`postgres_env` file, connects it to the `adscraper` Docker network, and
exposes the database at localhost:5432 (you can access it with the psql tool at
that host/port). 
```
docker run \
  --name adscraper-postgres \
  --mount source=adscraper_data,target=/var/lib/postgresql/data \
  --env-file ./postgres_env \
  --net adscraper \
  -p 127.0.0.1:5432:5432 \
  -d \
  postgres:13
```

Lastly, create the database and tables:
```
psql -d adscraper -U <YOUR_POSTGRES_USERNAME> -h localhost -p 5432 -f ./adscraper.sql
```

### Setup (for VPN/Distributed Crawls)
When crawling in a VPN, or doing distributed crawling, the crawler may need
to reach the database over the internet.

The (less secure) workaround is to
expose the database port to the public internet - this is not recommended,
as port scanners will try to find and access databases with weak passwords
or authentication.

This command starts a container exposed to the public internet at port 5432.
```
docker run \
  --name postgres \
  --mount source=scraper_data,target=/var/lib/postgresql/data \
  --env-file ./postgres_env \
  -p 5432:5432 \
  --net adscraper \
  -d \
  postgres:13
```

An alternative solution is to create SSH tunnels between your remote machines,
mapping the postgres port on the database server to a local port on the crawler
machine:
```
ssh -L 5432:localhost:5432 user@database_server.address
```

## Backing up a Postgres container
This command dumps the data from the database into backup files. You can restore
the data using pg_restore.
```pg_dump -h localhost -U adscraper -Fd adscraper -j 6 -f <dumpdir>```
