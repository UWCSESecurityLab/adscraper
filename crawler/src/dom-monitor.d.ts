import puppeteer from 'puppeteer';
/**
* Injects MutationEvent listeners into the page to detect DOM changes
* (potentially) made by 3rd party scripts. DOM updates are relayed to puppeteer
* context by exposing the trackDOMUpdate function to the page.
* @param page Page to listen for DOM changes in.
*/
export declare function injectDOMListener(page: puppeteer.Page): Promise<void>;
/**
 * Puppeteer-side handler for receiving DOM mutation updates, for tracking
 * third party scripts that change the DOM.
 * Takes a browser-side stack trace and DOM element ID from a MutationEvent,
 * extracts the JS resource URLs from the stack trace, and stores a mapping
 * of ElementHandle to URLs in the globally scoped DOM update map.
 * @param page           Page the DOM update occurred on
 * @param data.eventType Type of the detected MutationEvent
 * @param data.elementId ID of the mutated element or its parent
 * @param data.stack     Stack trace of the mutation event
 */
export declare function trackDOMUpdate(page: puppeteer.Page, data: {
    eventType: string;
    elementId: string;
    stack: string;
}): Promise<void>;
/**
 * Given a list of element handles to ads, returns a list of DOM mutations
 * to those elements.
 * @param page The page the ad(s) appeared on
 * @param adHandleToAdId Handles to ads
 */
export declare function matchDOMUpdateToAd(page: puppeteer.Page, adHandleToAdId: Map<puppeteer.ElementHandle, number>): Promise<any[]>;
//# sourceMappingURL=dom-monitor.d.ts.map