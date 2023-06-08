import puppeteer from 'puppeteer';
import { Client } from 'pg';
import DbClient from './db.js';

let db: DbClient, postgres: Client, browser: puppeteer.Browser;

interface ScrapedHTML {
  adId: number,
  iframeId?: number,
  html: string,
}

async function extractDomainsFromAds() {
  const results = await postgres.query('SELECT id, html FROM ad WHERE html IS NOT NULL');
  let scrapedHtmls = results.rows.map(row => { return { adId: row.id, html: row.html } });
  await extractDomains(scrapedHtmls);
}

async function extractDomainsFromIframes() {
  const results = await postgres.query('SELECT id, parent_ad, html FROM iframe WHERE html IS NOT NULL');
  let scrapedHtmls = results.rows.map(row => { return { adId: row.parent_ad, iframeId: row.id, html: row.html } });
  await extractDomains(scrapedHtmls, 'subframe_');
}

async function extractDomains(scrapedHtmls: ScrapedHTML[], typePrefix?: string) {
  console.log(`Analyzing ${scrapedHtmls.length} documents`);
  for (let scrapedHtml of scrapedHtmls) {
    const page = await browser.newPage();
    try {
      await page.setContent(`<html><body>${scrapedHtml.html}</body></html>`);

      const anchorHrefs = await page.$$eval('a', (elements) => {
        let anchors = elements as HTMLAnchorElement[];
        return anchors.map(a => a.href);
      });
      const iframeSrcs = await page.$$eval('iframe', (elements) => {
        let iframes = elements as HTMLIFrameElement[];
        return iframes.map(iframe => iframe.src);
      });
      const scriptSrcs = await page.$$eval('script', (elements) => {
        let scripts = elements as HTMLScriptElement[];
        return scripts.map(script => script.src);
      });
      const imgSrcs = await page.$$eval('img', (elements) => {
        let imgs = elements as HTMLImageElement[];
        return imgs.map(img => img.src);
      });

      const insertDomains = async (domains: string[], type: string) => {
        for (let d of domains) {
          try {
            let hostname = new URL(d).hostname;
            await db.insertAdDomain({
              ad_id: scrapedHtml.adId, iframe_id: scrapedHtml.iframeId, url: d, hostname: hostname, type: type
            });
          } catch (e: any) {
            if (e.name === 'TypeError') {
              await db.insertAdDomain({
                ad_id: scrapedHtml.adId, iframe_id: scrapedHtml.iframeId, url: d, type: type
              });
            } else {
              console.log(e);
            }
          }
        }
      };

      await insertDomains(anchorHrefs, `${typePrefix ? typePrefix : ''}anchor_href`);
      await insertDomains(iframeSrcs, `${typePrefix ? typePrefix : ''}iframe_src`);
      await insertDomains(scriptSrcs, `${typePrefix ? typePrefix : ''}script_src`);
      await insertDomains(imgSrcs, `${typePrefix ? typePrefix : ''}img_src`)

      await page.close();
    } catch (e) {
      console.log(`Error processing Ad ID: ${scrapedHtml.adId}, iframe ID: ${scrapedHtml.iframeId}`);
      console.log(e);
    }
  }
}


(async () => {
  postgres = new Client({
    host: 'localhost',
    port: 5432,
    user: 'adscraper',
    password: 'batteryhorsestaple',
    database: 'adscraper'
  });
  await postgres.connect();
  db = new DbClient(postgres);

  browser = await puppeteer.launch();
  if (process.argv.includes('--ads')) {
    await extractDomainsFromAds();
  }
  if (process.argv.includes('--iframes')) {
    await extractDomainsFromIframes();
  }
  await browser.close();
  process.exit(0);
})();
