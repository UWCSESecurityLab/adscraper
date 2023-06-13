import { ElementHandle } from 'puppeteer';

export interface AdExternalUrls {
  anchorHrefs: string[],
  iframeSrcs: string[],
  scriptSrcs: string[],
  imgSrcs: string[]
}

// Extracts URLs in the HTML content of an ad, such as the "href" attribute in
// an <a> element, or the "src" attribute in an <img> element.
// This data can sometimes indicate the provenance of an ad.
export async function extractExternalUrls(handle: ElementHandle) {
  const anchorHrefs = await handle.$$eval('a', (elements) => {
    let anchors = elements as HTMLAnchorElement[];
    return anchors.map(a => a.href);
  });
  const iframeSrcs = await handle.$$eval('iframe', (elements) => {
    let iframes = elements as HTMLIFrameElement[];
    return iframes.map(iframe => iframe.src);
  });
  const scriptSrcs = await handle.$$eval('script', (elements) => {
    let scripts = elements as HTMLScriptElement[];
    return scripts.map(script => script.src);
  });
  const imgSrcs = await handle.$$eval('img', (elements) => {
    let imgs = elements as HTMLImageElement[];
    return imgs.map(img => img.src);
  });

  return {
    anchorHrefs: anchorHrefs,
    iframeSrcs: iframeSrcs,
    scriptSrcs: scriptSrcs,
    imgSrcs: imgSrcs
  };
}