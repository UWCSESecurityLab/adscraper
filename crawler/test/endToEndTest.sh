#!/bin/bash

cd "$(dirname "$0")"

# Placeholder for some real tests... runs the crawler with a small crawl list.
# Verify for yourself if the output looks reasonable.
node ../gen/crawler-cli.js \
  --output_dir=./test_output \
  --name=test \
  --crawl_list=./crawl_list.txt \
  --pg_host=localhost \
  --pg_port=5432 \
  --pg_user=postgres \
  --pg_database=adscraper \
  --profile_dir=./test_profile \
  --scrape_site \
  --scrape_ads \
  --capture_third_party_request_urls \
  --click_ads=clickAndBlockLoad
