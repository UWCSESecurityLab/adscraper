import path from 'path';
import DbClient from './db.js';

// Returns a relative path to the output directory for the current crawl
// If a crawl name is specified: <crawlName>
// If no crawl name is specified: crawl_<crawlId>
// If the crawl is part of a job: job_<jobId>/<crawlName>
// If the crawl is part of a job and no crawl name is specified: job_<jobId>/crawl_<crawlId>
// This path is relative to FLAGS.outputDir.
export default async function getCrawlOutputDirectory(referrerAd?: number) {
  const tokens = [];
  if (FLAGS.jobId) {
    tokens.push('job_' + FLAGS.jobId);
  }

  let crawlId: number;
  let crawlName: string | undefined;

  if (referrerAd) {
    const db = DbClient.getInstance();
    const res = await db.postgres.query('SELECT crawl.* FROM ad JOIN crawl ON ad.crawl_id=crawl.id WHERE ad.id=$1', [referrerAd]);
    if (res.rowCount != 1) {
      throw new Error(`Can't generate output directory, no crawl id associated with ad ${referrerAd}.`);
    }
    crawlId = res.rows[0].id;
    crawlName = res.rows[0].name;

  } else {
    crawlId = CRAWL_ID;
    crawlName = FLAGS.crawlName;
  }

  if (crawlName) {
    tokens.push(crawlName);
  } else {
    tokens.push('crawl_' + crawlId);
  }
  return path.join(...tokens);
}