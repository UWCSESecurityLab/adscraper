import amqp from 'amqplib';
import cliProgress from 'cli-progress';
// import { CrawlerFlagsWithProfileHandling } from
import fs from 'fs';
import csvParser from 'csv-parser';


let crawlMessageTemplate: any = {
  jobId: 150,
  outputDir: '/home/pptruser/data',
  resumeIfAble: false,
  // url: 'https://www.sharecare.com/joint-health/arthritis/ankylosing-spondylitis-mental-health',
  // adId: 232932,
  chromeOptions: { headless: 'new' },
  crawlOptions: {
    shuffleCrawlList: false,
    findAndCrawlPageWithAds: 0,
    findAndCrawlArticlePage: false
  },
  scrapeOptions: {
    scrapeSite: true,
    scrapeAds: false,
    clickAds: 'noClick',
    screenshotAdsWithContext: false,
    captureThirdPartyRequests: true
  },
  profileOptions: { useExistingProfile: false, writeProfile: false }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeToAmqpQueue(messages: any[], channel: amqp.Channel, queue: string) {
  const pbar = new cliProgress.SingleBar({});
  pbar.start(messages.length, 0);

  return new Promise<void>((resolve, reject) => {
    // Send a message every 1ms; back off if the queue fills up.
    async function write() {
      let ok = true;
      do {
        let message = messages.shift();
        ok = channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)));
        await sleep(1);
        pbar.increment();
      } while (ok && messages.length > 0);
      if (messages.length > 0) {
        channel.once('drain', write);
      } else {
        pbar.stop();
        resolve();
      }
    }
    write();
  });
}

(async function () {
  const brokerUrl = `amqp://guest:guest@localhost:30365`;
  const amqpConn = await amqp.connect(brokerUrl);
  const amqpChannel = await amqpConn.createChannel();
  const QUEUE = `job150`;

  let crawlMessages: any[] = [];


  // Read the CSV file and create a crawl message for each row.
  const csvPath = '/data/inputs/enriched_test/uncrawled.csv';
  const csv = fs.createReadStream(csvPath).pipe(csvParser());
  for await (const row of csv) {
    let message = JSON.parse(JSON.stringify(crawlMessageTemplate));
    message.url = row.url;
    message.adId = Number(row.ad_id);
    crawlMessages.push(message);
    // console.log(message);
  }
  await amqpChannel.assertQueue(QUEUE);
  await writeToAmqpQueue(crawlMessages, amqpChannel, QUEUE);
}());