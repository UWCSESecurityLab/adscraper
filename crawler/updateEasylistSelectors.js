import fs from 'fs';

// Script to update the ad CSS selectors file (used internally to detect ads)
// with the latest definitions from Easylist.
async function fetchFilterList(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    console.log(res.statusText);
    process.exit(1);
  }
  const raw = await res.text();
  const rows = raw.split('\n');
  const selectorRows = rows
      .filter(r => r.startsWith('##'))
      .map(row => row.substring(2));
  fs.writeFileSync(dest, JSON.stringify(selectorRows, undefined, 2));
}

(async () => {
  await fetchFilterList(
    'https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_general_hide.txt',
    'src/ads/easylist_ad_selectors.json');
  console.log('Wrote updated ad selectors to src/ads/easylist_ad_selectors.json');

  await fetchFilterList(
    'https://raw.githubusercontent.com/easylist/easylist/master/easylist_cookie/easylist_cookie_general_hide.txt',
    'src/pages/easylist_cookie_general_hide.json');
  console.log('Wrote updated cookie banner selectors to src/pages/easylist_cookie_general_hide.json');
  console.log('Done');
  process.exit(0);
})();
