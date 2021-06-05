import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import readline from 'readline';
import cliProgress from 'cli-progress';
import os from 'os';

async function main() {
  const optionsDefinitions: commandLineUsage.OptionDefinition[] = [
    {
      name: 'job_id',
      alias: 'j',
      type: Number,
      description: 'Job ID to delete'
    },
    {
      name: 'pg_creds',
      alias: 'p',
      type: String,
      description: 'Postgres credentials file'
    }
  ];
  const usage = [
    {
      header: 'Delete Job',
      content: 'Deletes a job, all of its associated records, and screenshots from the database.'
    },
    {
      header: 'Arguments',
      optionList: optionsDefinitions
    }
  ];
  const options = commandLineArgs(optionsDefinitions);

  if (!options.job_id) {
    console.log(commandLineUsage(usage));
    process.exit(1);
  }

  const pg = new Client(
    JSON.parse(fs.readFileSync(path.resolve(options.pg_creds)).toString()));
  await pg.connect();

  const jobQ = await pg.query(`select job.id, name, job.timestamp, input_files,
    crawler_hostname, crawler_ip, geolocation, COUNT(ad.id) AS count_ads
    FROM job
    LEFT JOIN crawl ON job.id=crawl.job_id
    LEFT JOIN page ON page.crawl_id=crawl.id
    LEFT JOIN ad ON ad.parent_page=page.id
    WHERE job.id=$1
    GROUP BY job.id;`, [options.job_id]);

  if (jobQ.rowCount !== 1) {
    console.log(`No job with id ${options.job_id}`);
    process.exit(1);
  }
  console.log(jobQ.rows[0]);

  if (jobQ.rows[0].crawler_hostname !== os.hostname()) {
    console.log(`This job was crawled on ${jobQ.rows[0].crawler_hostname}, please run this script there to properly delete all of the data.`);
    process.exit(1);
  }

  function confirmation(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question('Delete this job? [y/n] ', (name) => {
        if (name.toLowerCase() === 'y') {
          resolve(true);
        } else if (name.toLowerCase() === 'n') {
          resolve(false);
        } else {
          reject()
        }
        rl.close()
      });
    });
  }

  try {
    const confirm = await confirmation();
    if (!confirm) {
      console.log('Aborting delete');
      process.exit(0);
    }
  } catch (e) {
    console.log('Please provide "y" or "n"');
    process.exit(1);
  }

  try {
    const ad_domain = await pg.query(`DELETE FROM ad_domain
      WHERE ad_domain.ad_id IN (
        SELECT ad.id
        FROM ad
        JOIN page ON ad.parent_page = page.id
        JOIN crawl ON page.crawl_id=crawl.id
        JOIN job ON job.id=crawl.job_id
        WHERE job.id=$1
      )`, [options.job_id]);
    console.log(`Deleted ${ad_domain.rowCount} rows from ad_domain`);

    const iframe =  await pg.query(`DELETE FROM iframe
      WHERE iframe.parent_ad IN (
        SELECT ad.id
        FROM ad
        JOIN page ON ad.parent_page = page.id
        JOIN crawl ON page.crawl_id=crawl.id
        JOIN job ON job.id=crawl.job_id
        WHERE job.id=$1
      )`, [options.job_id]);
    console.log(`Deleted ${iframe.rowCount} rows from iframe`);

    // Delete pages and ads in order of depth, starting with the highest depth,
    // because of REFERENCES constraints
    const maxDepth = Math.max(
      (await pg.query(`SELECT MAX(depth) FROM super_ad WHERE job_id=$1`, [options.job_id])).rows[0].max,
      (await pg.query(`SELECT MAX(depth) FROM super_page WHERE job_id=$1`, [options.job_id])).rows[0].max
    );
    console.log(`max depth = ${maxDepth}`);
    for (let i = maxDepth; i > 0; i--) {
      if (i % 2 === 0) {
        await deleteAds(pg, i, options.job_id);
      } else {
        await deletePages(pg, i, options.job_id);
      }
    }

    const crawl = await pg.query(
        `DELETE FROM crawl WHERE crawl.job_id=$1`, [options.job_id]);
    console.log(`Deleted ${crawl.rowCount} rows from crawl`);

    await pg.query(`DELETE FROM job WHERE id=$1`, [options.job_id]);
    console.log('Deleted job');

    console.log('Done');
    await pg.end();
    process.exit(0);
  } catch (e) {
    console.log(e);
    await pg.end();
    process.exit(1);
  }
}


async function deleteAds(pg: Client, depth: number, jobId: number) {
  try {
    console.log(`Deleting depth=${depth} ads`);
    const adScreenshots = await pg.query(`SELECT ad.screenshot
        FROM ad
        JOIN page ON ad.parent_page = page.id
        JOIN crawl ON page.crawl_id=crawl.id
        JOIN job ON job.id=crawl.job_id
        WHERE job.id=$1 AND ad.screenshot is not null AND ad.depth=$2`, [jobId, depth]);

    const adsBar = new cliProgress.Bar({
      format: 'Deleting ad screenshots [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}'
    });
    adsBar.start(adScreenshots.rowCount, 0);
    for (let row of adScreenshots.rows) {
      if (fs.existsSync(row.screenshot)) {
        fs.unlinkSync(row.screenshot);
      } else {
        console.log(`${row.screenshot} does not exist`);
      }
      adsBar.increment();
    }
    adsBar.stop();

    const ad =  await pg.query(`DELETE FROM ad
      WHERE ad.parent_page IN (
        SELECT page.id
        FROM page
        JOIN crawl ON page.crawl_id=crawl.id
        JOIN job ON job.id=crawl.job_id
        WHERE job.id=$1 AND page.depth=$2
      )`, [jobId, depth - 1]);
    console.log(`Deleted ${ad.rowCount} rows from ad`);
  } catch (e) {
    throw e;
  }
}

async function deletePages(pg: Client, depth: number, jobId: number) {
  try {
    console.log(`Deleting depth=${depth} pages`);
    const pageScreenshots = await pg.query(`SELECT screenshot
      FROM page
      JOIN crawl ON page.crawl_id=crawl.id
      JOIN job ON job.id=crawl.job_id
      WHERE job.id=$1 AND screenshot is not null AND depth=$2`, [jobId, depth]);

    const pageBar = new cliProgress.Bar({
      format: 'Deleting page screenshots [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}'
    });
    pageBar.start(pageScreenshots.rowCount, 0);
    for (let row of pageScreenshots.rows) {
      if (fs.existsSync(row.screenshot)) {
        fs.unlinkSync(row.screenshot);
      }
    pageBar.increment()
    }
    pageBar.stop();

    const chumbox = await pg.query(`DELETE FROM chumbox
    WHERE chumbox.parent_page IN (
      SELECT page.id
      FROM page
      JOIN crawl ON page.crawl_id=crawl.id
      JOIN job ON job.id=crawl.job_id
      WHERE job.id=$1 AND page.depth=$2
    )`, [jobId, depth]);
    console.log(`Deleted ${chumbox.rowCount} rows from chumbox`);

    const page = await pg.query(`DELETE FROM page
      WHERE page.crawl_id IN (
        SELECT crawl.id FROM crawl WHERE job_id=$1)
      AND page.depth=$2`, [jobId, depth]);
    console.log(`Deleted ${page.rowCount} rows from page`);
  } catch (e) {
    throw e;
  }
}

main();