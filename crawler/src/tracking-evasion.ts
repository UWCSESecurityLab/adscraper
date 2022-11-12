import * as log from './log.js';
import puppeteer from 'puppeteer';


// Evade platform-based targeting/screening by spoofing the user agent to
// imitate a windows based machine.
export async function spoofUserAgent(browser: puppeteer.Browser) {
  const version = await browser.version();
  browser.on('targetcreated', (target) => {
    if (target.type() !== 'page') {
      return;
    }
    target.createCDPSession().then((cdp) => {
      cdp.send('Network.setUserAgentOverride', {
        userAgent: `Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) ${version} Safari/537.36`,
        platform: 'Win32'
      });
    });
  });
}

// Evade checks for headless Chrome. Must run with every new page before navigating.
export async function evadeHeadlessChromeDetection(page: puppeteer.Page) {
  return page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    // @ts-ignore
    window.navigator.chrome = {"app":{"isInstalled":false,"InstallState":{"DISABLED":"disabled","INSTALLED":"installed","NOT_INSTALLED":"not_installed"},"RunningState":{"CANNOT_RUN":"cannot_run","READY_TO_RUN":"ready_to_run","RUNNING":"running"}},"runtime":{"OnInstalledReason":{"CHROME_UPDATE":"chrome_update","INSTALL":"install","SHARED_MODULE_UPDATE":"shared_module_update","UPDATE":"update"},"OnRestartRequiredReason":{"APP_UPDATE":"app_update","OS_UPDATE":"os_update","PERIODIC":"periodic"},"PlatformArch":{"ARM":"arm","ARM64":"arm64","MIPS":"mips","MIPS64":"mips64","X86_32":"x86-32","X86_64":"x86-64"},"PlatformNaclArch":{"ARM":"arm","MIPS":"mips","MIPS64":"mips64","X86_32":"x86-32","X86_64":"x86-64"},"PlatformOs":{"ANDROID":"android","CROS":"cros","LINUX":"linux","MAC":"mac","OPENBSD":"openbsd","WIN":"win"},"RequestUpdateCheckStatus":{"NO_UPDATE":"no_update","THROTTLED":"throttled","UPDATE_AVAILABLE":"update_available"}}};

    const originalQuery = window.navigator.permissions.query;
    //@ts-ignore
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
    Object.defineProperty(navigator, 'plugins', {
      // This just needs to have `length > 0` for the current test,
      // but we could mock the plugins too if necessary.
      get: () => [{type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: Plugin}],
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en', ''],
    });
  });
}

/**
 * Disable cookies to evade cookie-based tracking within a single crawl session.
 * Automatically opens chrome://settings and toggles relevant settings.
 * @param browser Puppeteer browser instance to disable cookies in
 * @param disableAllCookies Disable all cookies
 * @param disableThirdPartyCookies Disable 3rd party cookies
 */
export async function disableCookies(
    browser: puppeteer.Browser,
    disableAllCookies: boolean,
    disableThirdPartyCookies: boolean) {
  if (!disableAllCookies && !disableThirdPartyCookies) {
    return;
  }
  const page = await browser.newPage();

  // Clicks on an element retrieved via in-page JavaScript selection
  // (needed for this because chrome://settings uses web components heavily)
  const clickToggle = async function(selectorFn: (...args: any[]) => any) {
    let jsHandle = await page.evaluateHandle(selectorFn);
    if (!jsHandle) {
      log.strError('Chrome cookies toggle query selector did not return a valid JSHandle');
      return;
    }
    let element = jsHandle.asElement();
    if (!element) {
      log.strError('Chrome cookies toggle JSHandle is not an Element');
      return;
    }
    await element.click();
  }

  await page.goto('chrome://settings/content/cookies');
  await page.waitForTimeout(2000);

  if (disableAllCookies) {
    await clickToggle(() => {
      // @ts-ignore
      return document.querySelector("body > settings-ui")
          .shadowRoot.querySelector("#main")
          .shadowRoot.querySelector("settings-basic-page")
          .shadowRoot.querySelector("#advancedPage > settings-section.expanded > settings-privacy-page")
          .shadowRoot.querySelector("#pages > settings-subpage > category-default-setting");
    });
  }
  if (disableAllCookies || disableThirdPartyCookies) {
    await clickToggle(() => {
      // @ts-ignore
      return document.querySelector("body > settings-ui")
          .shadowRoot.querySelector("#main")
          .shadowRoot.querySelector("settings-basic-page")
          .shadowRoot.querySelector("#advancedPage > settings-section.expanded > settings-privacy-page")
          .shadowRoot.querySelector("#pages > settings-subpage > settings-toggle-button");
    });
    browser.on('targetcreated', (target) => {
      if (target.type() !== 'page') {
        return;
      }
      target.createCDPSession().then((cdp) => {
        cdp.send('Emulation.setDocumentCookieDisabled', { disabled: true });
      });
    });
  }
  page.close();
}