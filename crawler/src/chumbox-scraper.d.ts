import { ElementHandle } from 'puppeteer';
import { AdHandles } from './ad-scraper.js';
export declare function splitChumbox(ad: ElementHandle): Promise<{
    adblade: AdHandles[];
    contentad: AdHandles[];
    feednetwork: AdHandles[];
    mgid: AdHandles[];
    outbrain: AdHandles[];
    revcontent: AdHandles[];
    taboola: AdHandles[];
    zergnet: AdHandles[];
}>;
//# sourceMappingURL=chumbox-scraper.d.ts.map