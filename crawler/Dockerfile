# Docker image for the adscraper command line interface.
FROM ghcr.io/puppeteer/puppeteer:23.4.0

USER root
RUN apt-get update && apt-get install -y curl ca-certificates amqp-tools jq

USER pptruser

COPY --chown=pptruser:pptruser package*.json .
RUN npm install
COPY --chown=pptruser:pptruser . .
RUN npx tsc \
    && npx typescript-json-schema ./tsconfig.json CrawlerFlags > ./gen/crawlerFlagsSchema.json

ENTRYPOINT node gen/crawler-cli.js
