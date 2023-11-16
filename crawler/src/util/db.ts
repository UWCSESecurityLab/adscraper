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

export interface dbUpdateOptions {
  table: string,
  id: number,
  data: {
    [column: string]: any
  }
}

export interface Ad {
  job_id?: number,
  crawl_id: number,
  timestamp?: Date,
  url?: string,
  html?: string
  screenshot?: string,
  screenshot_host?: string,
  parent_page?: number,
  parent_page_url?: string,
  parent_page_type?: string,
  chumbox_id?: number,
  platform?: string,
  winning_bid?: boolean,
  max_bid_price?: number
  with_context?: boolean,
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
  crawl_list_url: string,
  html?: string
  screenshot?: string,
  screenshot_host?: string,
  page_type: string,
  job_id: number,
  crawl_id: number,
  referrer_page?: number,
  referrer_page_url?: string,
  referrer_ad?: number
}

export interface WebRequest {
  timestamp: Date,
  parent_page: number,
  initiator: string,
  target_url: string,
  resource_type: string
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
  }

  async updateById(options: dbUpdateOptions) {
    const columns = Object.keys(options.data)
        .map((col, idx) => `${col}=$${idx+1}`)
        .join(', ');
    const params = Object.values(options.data);
    params.push(options.id);
    const update = `UPDATE ${options.table} SET ${columns} WHERE id=$${params.length}`;
    const result = await this.postgres.query(update, params);
    if (!result.rowCount || result.rowCount == 0) {
      log.warning(`Could not update row in table ${options.table} with id ${options.id}`);
    } else if (result.rowCount > 1) {
      log.warning(`Updated more than one row in ${options.table} with id ${options.id}`);
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

  async createAd(ad: Ad) {
    const adId = await this.insert({
      table: 'ad',
      returning: 'id',
      data: ad
    }) as number;
    return adId;
  }

  async createEmptyAd() {
    const result = await this.postgres.query(
      'INSERT INTO ad DEFAULT VALUES RETURNING id');
    return result.rows[0].id as number;
  }

  async updateAd(id: number, ad: Ad) {
    return this.updateById({
      table: 'ad',
      id: id,
      data: ad
    });
  }

  async archivePage(page: Page): Promise<number> {
    const pageId = await this.insert({
      table: 'page',
      returning: 'id',
      data: page
    }) as number;
    return pageId;
  }

  async insertAdDomain(adDomain: AdDomain) {
    this.insert({
      table: 'ad_domain',
      data: adDomain
    });
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

  async archiveRequest(request: WebRequest) {
    await this.insert({
      table: 'request',
      data: request
    });
  }
}