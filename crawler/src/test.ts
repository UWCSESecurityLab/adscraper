import puppeteer, { Connection, Target } from "puppeteer";

let browser = await puppeteer.launch({
  headless: false
});



browser.on('targetcreated', async (target: Target) => {
  if (target.type() !== 'page') {
    return;
  }
  // console.log(target);
  console.log(
`targetcreated
URL:  ${target.url()}
Type:  ${target.type()}
Opener: ${target.opener()?.url()}
Worker? ${await !!target.worker()}

`);
});

const page = (await browser.pages())[0];

await page.goto('https://www.nytimes.com');

await page.setRequestInterception(true);

// Event listener for request interception
page.on('request', (request) => {
  if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      // If the current tab is being navigated, abort the request
      // and store the URL. This stops the page from navigating.
      console.log('Intercepted navigation to: ' + request.url().substring(0, Math.min(15, request.url().length)) + '...');
      // interceptedAdUrl = request.url();
      request.abort('aborted');
  } else {
      // If it's not a navigation request, or not in the main frame, ignore
      // console.log('Non navigation request allowed: ' + request.url());
      request.continue();
  }
});


const cdp = await browser.target().createCDPSession();
console.log('CDP Session ID:', cdp.id());

await cdp.send('Target.setAutoAttach', {
  waitForDebuggerOnStart: true,
  autoAttach: true,
  flatten: true,
  filter: [
    { type: 'page', exclude: false },
  ]
})

cdp.on('Target.attachedToTarget', async ({sessionId, targetInfo, waitingForDebugger}) => {
  console.log(`Target.attachedToTarget
sessionID: ${sessionId}
type: ${targetInfo.type}
url: ${targetInfo.url}
waitingForDebugger: ${waitingForDebugger},
subtype: ${targetInfo.subtype}
`);
  let connection = cdp.connection();
  if (!connection) {
    console.log('Could not get connection');
    return;
  }
  let popupCdp = connection.session(sessionId);
  if (!popupCdp) {
    console.log('Could not get popup CDP session');
    return;
  }

  // console.log('New popup session ID:', popupCdp.id());
  // await new Promise((resolve, reject) => {setTimeout(resolve, 5000)});
  console.log('Attempting to resume tab');


  await popupCdp.send('Fetch.enable');
  console.log('Fetch.enable sent');

  popupCdp.on('Fetch.requestPaused', async ({requestId, request}) => {
    console.log('Fetch.requestPaused:', request.url);
    popupCdp?.send('Fetch.failRequest', {requestId, errorReason: 'Aborted'});
    console.log('FailRequest sent');
  });

  await popupCdp.send('Runtime.runIfWaitingForDebugger');
  console.log('Runtime.runIfWaitingForDebugger sent');

  await popupCdp.send('Target.closeTarget', {targetId: targetInfo.targetId});
  // const pagecdp = await newPage.target().createCDPSession();


  // console.log('Running');
});

console.log('ready');


