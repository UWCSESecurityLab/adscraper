# Using older version of this image because npm install is broken
# when building linux/amd64 image on Mac Docker Deskop.
FROM node:18.17.0

# Install Google Chrome Stable and fonts
# Note: this installs the necessary libs to make the browser work with Puppeteer.
RUN apt-get update && apt-get install gnupg wget -y && \
  wget --quiet --output-document=- https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/trusted.gpg.d/google-archive.gpg && \
  sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
  apt-get update && \
  apt-get install -y curl ca-certificates amqp-tools google-chrome-stable \
     --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true
ENV PUPPETEER_EXECUTABLE_PATH /usr/bin/google-chrome

# Add user so we don't need --no-sandbox.
# same layer as npm install to keep re-chowned files from using up several hundred MBs more space
WORKDIR /crawler
COPY package*.json .
RUN npm install --loglevel verbose
COPY . .
RUN npx tsc \
    && npx typescript-json-schema ./tsconfig.json CrawlerFlags > ./gen/crawlerFlagsSchema.json \
    && mkdir data \
    && groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser . \
    && chown -R pptruser:pptruser /home/pptruser

# Run everything after as non-privileged user.
USER pptruser

# Pulls the next crawl spec off of the message queue.
# BROKER_URL and QUEUE specified in the k8s job config.
CMD /usr/bin/amqp-consume --url=$BROKER_URL -q $QUEUE -c 1 node gen/crawler-amqp.js

# Commands for building/running
# docker build . -t adscraper --platform linux/amd64
# docker run -i --init --rm --network=adscraper --cap-add=SYS_ADMIN --security-opt seccomp=./chrome.json adscraper