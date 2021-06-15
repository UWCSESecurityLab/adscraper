-- This script constructs the primary database storing scraped site, ad, and
-- clickthrough page data.

CREATE DATABASE adscraper;

CREATE TABLE job (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP,
  name TEXT,
  completed BOOLEAN,
  completion_time TIMESTAMP,
  max_page_depth INTEGER,
  max_depth INTEGER,
  crawler_hostname TEXT,
  crawler_ip TEXT,
  geolocation TEXT,
  vpn_hostname TEXT,
  input_files TEXT,
  warmed BOOLEAN,
  shuffled BOOLEAN
);

CREATE TABLE crawl (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES job(id),
  timestamp TIMESTAMP,
  seed_url TEXT,
  dataset TEXT,
  label TEXT,
  warming_crawl BOOLEAN
);

CREATE TABLE page (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP,
  url TEXT,
  domain TEXT,
  html TEXT,
  screenshot TEXT,
  screenshot_host TEXT,
  is_seed BOOLEAN,
  depth INTEGER,
  unranked BOOLEAN,
  job_id INTEGER REFERENCES job(id),
  crawl_id INTEGER REFERENCES crawl(id),
  referrer_page INTEGER references page(id),
  page_type TEXT
);

CREATE TABLE chumbox (
  id SERIAL PRIMARY KEY,
  platform TEXT,
  parent_page INTEGER REFERENCES page(id)
);

CREATE TABLE ad (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP,
  html TEXT,
  screenshot TEXT,
  screenshot_host TEXT,
  depth INTEGER,
  job_id INTEGER REFERENCES job(id),
  parent_page INTEGER REFERENCES page(id),
  platform TEXT,
  chumbox_id INTEGER REFERENCES chumbox(id),
  with_context BOOLEAN,
  max_bid_price NUMERIC,
  winning_bid BOOLEAN,
  bb_x INTEGER,
  bb_y INTEGER,
  bb_height INTEGER,
  bb_width INTEGER
);

-- Backreference from page -> ad, for landing pages
ALTER TABLE page ADD referrer_ad INTEGER REFERENCES ad(id);

CREATE INDEX ad_jobid_index ON ad(job_id);
CREATE INDEX ad_ts_index ON ad(timestamp);
CREATE INDEX referrer_ad_index ON page(referrer_ad);


CREATE TABLE iframe (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP,
  url TEXT,
  parent_ad INTEGER REFERENCES ad(id),
  parent_iframe INTEGER REFERENCES iframe(id),
  html TEXT,
  textcontent TEXT
);
CREATE INDEX iframe_ad_id_index ON iframe(parent_ad);

CREATE TABLE ad_domain (
  id SERIAL PRIMARY KEY,
  ad_id INTEGER REFERENCES ad(id),
  iframe_id INTEGER REFERENCES iframe(id),
  url TEXT,
  hostname TEXT,
  type TEXT
);
CREATE INDEX ad_domain_ad_id_index ON ad_domain(ad_id);


