import fs from 'fs';
import path from 'path';
import request from 'request';

request.get('https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_general_hide.txt', (err, res, body) => {
  if (err) {
    console.log(err);
    process.exit(1);
  }
  const raw = body as string;
  const rows = raw.split('\n');
  const selectorRows = rows
      .filter(r => r.startsWith('##'))
      .map(row => row.substring(2));
  // console.log(selectorRows);
  fs.writeFileSync('src/easylist_selectors.json', JSON.stringify(selectorRows, undefined, 2));
  // console.log('Wrote ')
});
