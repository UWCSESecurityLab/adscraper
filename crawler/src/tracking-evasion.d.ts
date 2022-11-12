import puppeteer from 'puppeteer';
export declare function spoofUserAgent(browser: puppeteer.Browser): Promise<void>;
export declare function evadeHeadlessChromeDetection(page: puppeteer.Page): Promise<void>;
/**
 * Disable cookies to evade cookie-based tracking within a single crawl session.
 * Automatically opens chrome://settings and toggles relevant settings.
 * @param browser Puppeteer browser instance to disable cookies in
 * @param disableAllCookies Disable all cookies
 * @param disableThirdPartyCookies Disable 3rd party cookies
 */
export declare function disableCookies(browser: puppeteer.Browser, disableAllCookies: boolean, disableThirdPartyCookies: boolean): Promise<void>;
//# sourceMappingURL=tracking-evasion.d.ts.map