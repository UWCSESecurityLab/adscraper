import path from 'path';

export default function getCrawlOutputDirectory(crawlId: number) {
  const tokens = [FLAGS.outputDir];
  if (FLAGS.jobId) {
    tokens.push('job_' + FLAGS.jobId);
  }
  if (FLAGS.name) {
    tokens.push('crawl_' + crawlId + '_' + FLAGS.name);
  } else {
    tokens.push('crawl_' + crawlId);
  }
  return path.join(...tokens);
}