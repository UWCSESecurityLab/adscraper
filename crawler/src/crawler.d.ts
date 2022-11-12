import { Client } from 'pg';
import { Entry } from "buttercup";
export interface CrawlerFlags {
    clearCookiesBeforeCT: boolean;
    crawlArticle: boolean;
    crawlerHostname: string;
    crawlPageWithAds: boolean;
    dataset: string;
    disableAllCookies: boolean;
    disableThirdPartyCookies: boolean;
    jobId: number;
    label?: string;
    maxPageCrawlDepth: number;
    screenshotAdsWithContext: boolean;
    screenshotDir: string;
    externalScreenshotDir?: string;
    skipCrawlingSeedUrl: boolean;
    url: string;
    warmingCrawl: boolean;
    updateCrawlerIpField: boolean;
}
export declare function crawl(flags: CrawlerFlags, postgres: Client, profile: Entry): Promise<void>;
//# sourceMappingURL=crawler.d.ts.map