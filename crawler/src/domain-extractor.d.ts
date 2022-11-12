import puppeteer from 'puppeteer';
export interface ExternalDomains {
    anchorHrefs: string[];
    iframeSrcs: string[];
    scriptSrcs: string[];
    imgSrcs: string[];
}
export declare function extractExternalDomains(handle: puppeteer.ElementHandle): Promise<{
    anchorHrefs: string[];
    iframeSrcs: string[];
    scriptSrcs: string[];
    imgSrcs: string[];
}>;
//# sourceMappingURL=domain-extractor.d.ts.map