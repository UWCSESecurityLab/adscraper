import fs from 'fs';

// Script to update the ad CSS selectors file (used internally to detect ads)
// with the latest definitions from Easylist.

fetch('https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_general_hide.txt').then(res => {
  if (!res.ok) {
    console.log(res.statusText);
    process.exit(1);
  }
  return res.text();
}).then(raw => {
  const rows = raw.split('\n');
  const selectorRows = rows
      .filter(r => r.startsWith('##'))
      .map(row => row.substring(2));
  fs.writeFileSync('src/ads/easylist_selectors.json', JSON.stringify(selectorRows, undefined, 2));
  console.log('Success - Wrote new selectors to src/ads/easylist_selectors.json');
});
