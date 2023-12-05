-- This script constructs the primary database storing scraped site, ad, and
-- clickthrough page data.

CREATE DATABASE adscraper;

CREATE TABLE job (
  id SERIAL PRIMARY KEY,
  name TEXT,
  start_time TIMESTAMPTZ,
  completed BOOLEAN,
  completed_time TIMESTAMPTZ,
  job_config JSON
);

CREATE TABLE crawl (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES job(id),
  name TEXT,
  start_time TIMESTAMPTZ,
  completed BOOLEAN,
  completed_time TIMESTAMPTZ,
  crawl_list TEXT,
  crawl_list_current_index INTEGER,
  crawl_list_length INTEGER,
  profile_dir TEXT,
  crawler_hostname TEXT,
  crawler_ip TEXT
  -- geolocation TEXT,
  -- vpn_hostname TEXT,
);

-- A row in this table is created for every page visited by the crawler.
CREATE TABLE page (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES job(id),
  crawl_id INTEGER REFERENCES crawl(id),
  -- When the page was scraped
  timestamp TIMESTAMPTZ,
  -- URL of the scraped page
  url TEXT,
  -- Domain name of url (for convenience)
  domain TEXT,
  -- Indicates whether this page came from the crawl list (main),
  -- from selecting a random link after visiting the crawl list page (subpage),
  -- or from clicking on an ad (landing).
  page_type TEXT,
  -- The original URL on the crawl list that this page originated from
  -- (may differ from url field if there was a redirect, or if this is a subpage
  -- or landing page)
  crawl_list_url TEXT,

  ------ Scraped Content ------
  -- Fields in this section are optional, page content is only scraped when
  -- the crawler is using the --scrape_page or --clickAndScrapeLandingPage args.

  -- Path to the HTML file containing the website's main document
  html TEXT,
  -- Path to the MHTML file containing the site's snapshot (full page capture,
  -- viewable in Chrome)
  mhtml TEXT,
  -- Path to the screenshot file
  screenshot TEXT,
  -- Hostname of the machine the scraped files are stored on
  screenshot_host TEXT,

  ------ Referrer metadata ------
  -- How this page was reached, if it is a landing page or subpage of the
  -- original crawl list URL.

  -- If this is a subpage or ad landing page, the URL of the parent page
  referrer_page_url TEXT,
  -- If this is a subpage or ad landing page, and the parent page was scraped,
  -- the id of the parent page.
  referrer_page INTEGER references page(id)
  -- If this is an ad landing page, the id of the ad that opened this page.
  -- Field is added later, after the ad table is defined.
  -- referrer_ad INTEGER references ad(id)
);

CREATE TABLE chumbox (
  id SERIAL PRIMARY KEY,
  platform TEXT,
  parent_page INTEGER REFERENCES page(id)
);

-- A row in this table is created for each (successfully) scraped ad.
CREATE TABLE ad (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES job(id),
  crawl_id INTEGER REFERENCES crawl(id),
  -- When the ad was scraped
  timestamp TIMESTAMPTZ,
  -- The initial URL that the ad links to. The actual landing page URL may differ;
  -- because of redirect chains.
  url TEXT,

  ------ Scraped Content ------
  -- HTML content of the ad
  html TEXT,
  -- Path to the screenshot file
  screenshot TEXT,
  -- Hostname of the crawler that the screenshot file is stored on
  screenshot_host TEXT,

  ------ Parent page metadata ------
  -- URL of the page the ad was found on (parent page)
  parent_page_url TEXT,
  -- Whether the parent page was reached from the crawl list (main), or
  -- reached from a link on the main page (subpage)
  parent_page_type TEXT,
  -- If the parent page was scraped, the id of the entry in the page relation
  parent_page INTEGER REFERENCES page(id),

  ------ Chumbox metadata ------
  -- If the ad was part of a "chumbox", the name of the ad network
  platform TEXT,
  -- ID to the chumbox table, which can be used to link together other ads
  -- in the chumbox
  chumbox_id INTEGER REFERENCES chumbox(id),

  ------ Header bidding metadata ------
  -- If the ad was placed through a header bidding auction in Prebid.js,
  -- the bid values
  max_bid_price NUMERIC,
  winning_bid BOOLEAN,

  ------ Screenshot crop metadata ------
  -- If the --screenshot_with_context option is passed,
  -- with_context will be true, and the bb_* fields specify
  -- the bounding box within the larger screenshot occupied by the ad.
  with_context BOOLEAN,
  bb_x INTEGER,
  bb_y INTEGER,
  bb_height INTEGER,
  bb_width INTEGER
);

-- Backreference from ad -> page, for landing pages
ALTER TABLE page ADD referrer_ad INTEGER REFERENCES ad(id);

CREATE INDEX ad_jobid_index ON ad(job_id);
CREATE INDEX ad_ts_index ON ad(timestamp);
CREATE INDEX referrer_ad_index ON page(referrer_ad);

-- Stores the content of iframes inside scraped ads.
CREATE TABLE iframe (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ,
  url TEXT,
  parent_ad INTEGER REFERENCES ad(id),
  parent_iframe INTEGER REFERENCES iframe(id),
  html TEXT,
  textcontent TEXT
);
CREATE INDEX iframe_ad_id_index ON iframe(parent_ad);

CREATE TABLE request (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ,
  parent_page INTEGER REFERENCES page(id),
  initiator TEXT,
  target_url TEXT,
  resource_type TEXT,
  sec_fetch_site TEXT
);
