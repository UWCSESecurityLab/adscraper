import { Client } from 'pg';
import { ScrapedIFrame } from './iframe-scraper.js';
import { ExternalDomains } from './domain-extractor.js';
export interface dbInsertOptions {
    table: string;
    returning?: string;
    data: {
        [column: string]: any;
    };
}
export interface Ad {
    timestamp: Date;
    html: string;
    screenshot?: string;
    screenshot_host?: string;
    selectors?: string;
    parent_page: number;
    depth: number;
    job_id: number;
    chumbox_id?: number;
    platform?: string;
    winning_bid?: boolean;
    max_bid_price?: number;
    with_context: boolean;
    bb_x?: number;
    bb_y?: number;
    bb_height?: number;
    bb_width?: number;
}
export interface AdDomain {
    ad_id: number;
    iframe_id?: number;
    url: string;
    hostname?: string;
    type: string;
}
export interface Page {
    timestamp: Date;
    url: string;
    html: string;
    screenshot: string;
    screenshot_host: string;
    depth: number;
    page_type: string;
    job_id: number;
    crawl_id: number;
    referrer_page?: number;
    referrer_ad?: number;
}
export default class DbClient {
    postgres: Client;
    constructor(postgres: Client);
    insert(options: dbInsertOptions): Promise<any>;
    archiveScrapedIFrame(iframe: ScrapedIFrame, adId: number, parentId?: number): Promise<void>;
    archiveAd(ad: Ad): Promise<number>;
    archivePage(page: Page): Promise<number>;
    insertAdDomain(adDomain: AdDomain): Promise<void>;
    archiveExternalDomains(externals: ExternalDomains, adId: number, iframeId?: number): Promise<void>;
}
//# sourceMappingURL=db.d.ts.map