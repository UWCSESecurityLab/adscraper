FROM ghcr.io/puppeteer/puppeteer:21.6.0

USER root
RUN apt-get update && apt-get install -y curl ca-certificates amqp-tools jq

USER pptruser

COPY --chown=pptruser:pptruser package*.json .
RUN npm install
COPY --chown=pptruser:pptruser . .
RUN npx tsc \
    && npx typescript-json-schema ./tsconfig.json CrawlerFlags > ./gen/crawlerFlagsSchema.json

CMD /usr/bin/amqp-consume --url=$BROKER_URL -q $QUEUE -c 1 node gen/crawler-amqp.js
