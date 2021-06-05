import cliProgress from 'cli-progress';
import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';
import fs from 'fs/promises';
import path from 'path';
import { Pool } from 'pg';

const optionsDefinitions: commandLineUsage.OptionDefinition[] = [
  {
    name: 'old_path',
    type: String,
    description: 'Previous folder of screenshots, all screenshots matching this path will be renamed.'
  },
  {
    name: 'new_path',
    type: String,
    description: 'New folder of screenshots, screenshots in old_path will be renamed to this path.'
  },
  {
    name: 'old_host',
    type: String,
    description: 'Host where old path of screenshots is located'
  },
  {
    name: 'new_host',
    type: String,
    description: 'Host where new path of screenshots is located'
  }
];
const usage = commandLineUsage([
  {
    header: 'Screenshot path renamer',
    content: `Given an old and new directory, updates database entries for screenshot file names, changing the parent directory but keeping file names the same.
        Does not move the screenshot files themselves!
        Run on the host of --new_path, as this script checks whether the screenshot files exist before renaming.`
  },
  {
    header: 'Arguments',
    optionList: optionsDefinitions
  }
]);
const options = commandLineArgs(optionsDefinitions);

if (!options.new_path || !options.old_path || !options.old_host || !options.new_host) {
  console.log(usage);
  process.exit(1);
}

async function main() {
  if (!(await fs.lstat(options.new_path)).isDirectory()) {
    console.log(`${options.new_path} is not a valid directory`);
    process.exit(1);
  }

  const pgCreds = await fs.readFile(
    path.join(__dirname, '../../postgres_credentials_superuser.json'));
  const pg = new Pool(JSON.parse(pgCreds.toString()));
  await pg.connect();

  const query = await pg.query(`SELECT id, screenshot
    FROM ad
    WHERE screenshot_host=$1
    AND screenshot LIKE '${options.old_path}%'`,
    [options.old_host]);

  const bar = new cliProgress.SingleBar({});
  bar.start(query.rowCount, 0);

  let adsNotMoved: {[id: number]: string} = {};

  await Promise.all(query.rows.map(async (row) => {
    const dirname = path.dirname(row.screenshot);
    if (dirname !== options.old_path && path.join(dirname, '/') !== options.old_path) {
      bar.increment();
      return;
    }

    const basename = path.basename(row.screenshot);

    try {
      const movedFile = path.join(options.new_path, basename);
      await fs.stat(movedFile);
      await pg.query(`UPDATE ad SET screenshot=$1, screenshot_host=$2 WHERE id=$3`, [movedFile, options.new_host, row.id]);
      bar.increment();
    } catch (e) {
      bar.increment();
      adsNotMoved[row.id] = row.screenshot;
      return;
    }
  }));
  bar.stop();
  console.log('Ads missing a screenshot file:');
  console.log(adsNotMoved);
  await pg.end();
}

main();