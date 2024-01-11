FROM node
RUN apt-get update && \
    apt-get install -y curl ca-certificates amqp-tools \
       --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*
COPY ./crawler.js /crawler.js
CMD  /usr/bin/amqp-consume --url=$BROKER_URL -q $QUEUE -c 1 node crawler.js
