// Defines custom process exit codes, can be used to determine if the
// crawler should be restarted or not by automated job runners.
export enum ExitCodes {
  OK = 0,
  // Crawl input validation errors, like missing fields or mismatched
  // crawl lists when resuming previous crawls. Cannot be restarted without
  //  fixing the inputs.
  INPUT_ERROR = 242,
  // Other errors that require manual intervention before restarting, like
  // file permission issues.
  NON_RETRYABLE_ERROR = 243,
  // Unexpected errors that occurred during the crawl. In many cases, like
  // timeouts or network errors, the crawl can be restarted.
  UNCAUGHT_CRAWL_ERROR = 244,
  // Unused in node, but this code is thrown by runCrawl.sh if an error
  // is encountered in other commands (e.g. rsync failures)
  RUN_SCRIPT_ERROR = 245,
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'INPUT_ERROR';
  }
}

export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NON_RETRYABLE_ERROR';
  }
}

export class UncaughtCrawlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UNCAUGHT_CRAWL_ERROR';
  }
}
