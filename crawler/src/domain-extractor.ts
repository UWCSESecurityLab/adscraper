import puppeteer from 'puppeteer';

export interface ExternalDomains {
  anchorHrefs: string[],
  iframeSrcs: string[],
  scriptSrcs: string[],
  imgSrcs: string[]
}

export async function extractExternalDomains(handle: puppeteer.ElementHandle) {
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