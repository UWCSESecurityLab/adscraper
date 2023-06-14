import pg from 'pg';
import { AdExternalUrls } from '../ads/ad-external-urls.js';
import { ScrapedIFrame } from '../ads/iframe-scraper.js';
import * as log from './log.js';

export interface dbInsertOptions {
  table: string,
  returning?: string,
  data: {
    [column: string]: any
  }
}

export interface Ad {
  timestamp: Date,
  html: string
  screenshot?: string,
  screenshot_host?: string,
  selectors?: string,
  parent_page?: number,
  // depth: number,
  job_id: number,
  chumbox_id?: number,
  platform?: string,
  winning_bid?: boolean,
  max_bid_price?: number
  with_context: boolean,
  bb_x?: number,
  bb_y?: number,
  bb_height?: number,
  bb_width?: number
}

export interface AdDomain {
  ad_id: number,
  iframe_id?: number,
  url: string,
  hostname?: string,
  type: string
}

export interface Page {
  timestamp: Date,
  url: string,
  html: string
  screenshot: string,
  screenshot_host: string,
  // depth: number,
  page_type: string,
  job_id: number,
  crawl_id: number,
  referrer_page?: number,
  referrer_ad?: number
}

/**
 * Wrapper over the postgres client for inserting data from the crawler.
 * Singleton class - call initialize() at the beginning, call getInstance()
 * subsequently from any other scope.
 */
export default class DbClient {
  static instance: DbClient;
  postgres: pg.Client;

  private constructor(conf: pg.ClientConfig) {
    this.postgres = new pg.Client(conf);
  }

  /**
   * Sets up a new DbClient. Must be called the first time this is used in
   * the script.
   * @param conf Postgres config
   * @returns A DbClient instance.
   */
  static async initialize(conf: pg.ClientConfig) {
    if (DbClient.instance) {
      await DbClient.instance.postgres.end();
    }
    DbClient.instance = new DbClient(conf);
    await DbClient.instance.postgres.connect();
    log.info('Postgres driver initialized');
    return DbClient.instance;
  }

  /**
   * Gets the DbClient.
   * @returns The global DbClient.
   */
  static getInstance() {
    if (!DbClient.instance) {
      throw new Error('DbClient must be initialized before use');
    }
    return DbClient.instance;
  }

  /**
   * Ends the client connection to the database.
   * @returns
   */
  async end() {
    return this.postgres.end();
  }

  /**
   * Generic insert wrapper
   * @param options
   * @returns
   */
  async insert(options: dbInsertOptions) {
    try {
      const columns = Object.keys(options.data).join(', ');
      const valuesStr = [...Array(Object.keys(options.data).length).keys()]
          .map((v) => `$${v+1}`).join(', ');
      const params = Object.values(options.data);

      let insert = `INSERT INTO ${options.table} (${columns}) VALUES (${valuesStr})`;
      if (options.returning) {
        insert += ` RETURNING ${options.returning}`;
      }
      insert += ';';

      const result = await this.postgres.query(insert, params);
      if (!options.returning) {
        return;
      }
      if (result.rowCount !== 1) {
        throw new Error('Insert query didn\'t return a value');
      }
      return result.rows[0][options.returning];
    } catch(e) {
      throw e;
    }
  }

  // Saves a scraped iframe to the database, and recursively saves any child
  // iframes as well.
  async archiveScrapedIFrame(iframe: ScrapedIFrame, adId: number, parentId?: number) {
    try {
      const frameId = await this.insert({
        table: 'iframe',
        returning: 'id',
        data: {
          timestamp: iframe.timestamp,
          url: iframe.url,
          parent_ad: adId,
          parent_iframe: parentId ? parentId : null,
          html: iframe.html
        }
      }) as number;
      if (iframe.externals) {
        await this.archiveExternalUrls(iframe.externals, adId, frameId);
      }
      for (let child of iframe.children) {
        await this.archiveScrapedIFrame(child, adId, frameId);
      }
    } catch (e: any) {
      log.strError('Error while archiving iframe ' + iframe.url);
      log.error(e);
    }
  }

  async archiveAd(ad: Ad) {
    try {
      const adId = await this.insert({
        table: 'ad',
        returning: 'id',
        data: ad
      }) as number;
      return adId;
    } catch (e) {
      throw e;
    }
  }

  async archivePage(page: Page): Promise<number> {
    try {
      const pageId = await this.insert({
        table: 'page',
        returning: 'id',
        data: page
      }) as number;
      return pageId;
    } catch (e) {
      throw e;
    }
  }

  async insertAdDomain(adDomain: AdDomain) {
    try {
      this.insert({
        table: 'ad_domain',
        data: adDomain
      });
    } catch (e) {
      throw(e);
    }
  }

  async archiveExternalUrls(externals: AdExternalUrls, adId: number, iframeId?: number) {
    const {anchorHrefs, iframeSrcs, scriptSrcs, imgSrcs} = externals;
    const insertDomains = async (domains: string[], type: string) => {
      for (let d of domains) {
        try {
          let hostname = new URL(d).hostname;
          await this.insertAdDomain({
            ad_id: adId, iframe_id: iframeId, url: d, hostname: hostname, type: type });
        } catch(e) {
          continue;
        }
      }
    };

    await insertDomains(anchorHrefs, `${iframeId ? 'subframe_' : ''}anchor_href`);
    await insertDomains(iframeSrcs, `${iframeId ? 'subframe_': ''}iframe_src`);
    await insertDomains(scriptSrcs, `${iframeId ? 'subframe_' : ''}script_src`);
    await insertDomains(imgSrcs, `${iframeId ? 'subframe_' : ''}img_src`)
  }
}