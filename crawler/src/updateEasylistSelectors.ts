import fs from 'fs';

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
  // console.log(selectorRows);
  fs.writeFileSync('src/easylist_selectors.json', JSON.stringify(selectorRows, undefined, 2));
  // console.log('Wrote ')
});
