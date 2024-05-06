// Defines custom process exit codes, can be used to determine if the
// crawler should be restarted or not by automated job runners.
export enum ExitCodes {
  OK = 0,
  // Crawl input validation errors, like missing fields or mismatched
  // crawl lists when resuming previous crawls. Cannot be restarted without
  //  fixing the inputs.
  INPUT_ERROR = 2421,
  // Other errors that require manual intervention before restarting, like
  // file permission issues.
  NON_RETRYABLE_ERROR = 2422,
  // Unexpected errors that occurred during the crawl. In many cases, like
  // timeouts or network errors, the crawl can be restarted.
  UNCAUGHT_CRAWL_ERROR = 2423,
  // Unused in node, but this code is thrown by runCrawl.sh if an error
  // is encountered in other commands (e.g. rsync failures)
  RUN_SCRIPT_ERROR = 2424,
}