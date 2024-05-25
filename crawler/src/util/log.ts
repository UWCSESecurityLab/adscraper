import chalk, { ChalkInstance } from 'chalk';
import fs from 'fs';
import dayjs from 'dayjs';
import path from 'path';
import { CrawlerFlags } from '../crawler.js';

export enum LogLevel {
  ERROR = 1,
  WARNING = 2,
  INFO = 3,
  DEBUG = 4,
  VERBOSE = 5
}

interface Log {
  ts: string;
  level: string;
  message: string;
  stack?: string;
}

declare global {
  var LOG_FILE: string;
  var LOG_LEVEL: LogLevel;
}

globalThis.LOG_FILE = '';
globalThis.LOG_LEVEL = LogLevel.INFO;

// Call to set where log files should be stored - directory structure and
// name are based on the job id and crawl name. If not called, no logs will
// be written to file.
export function setLogDirFromFlags(crawlerFlags: CrawlerFlags) {
  let logDirSegments = [crawlerFlags.outputDir, 'logs'];
  if (crawlerFlags.jobId) {
    logDirSegments.push(`job_${crawlerFlags.jobId.toString()}`);
  }
  let logDir = path.resolve(...logDirSegments);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  globalThis.LOG_FILE = path.resolve(logDir, `${crawlerFlags.crawlName}.txt`);
  globalThis.LOG_LEVEL = crawlerFlags.logLevel ? crawlerFlags.logLevel : LogLevel.INFO;
}

export function error(e: Error, url?: string) {
  let log = {
    ts: dayjs().format(),
    level: 'ERROR',
    message: `${url? url + ': ': ''}${e.message}`,
    stack: e.stack
  }
  if (LOG_LEVEL >= LogLevel.ERROR) {
    printLog(log, chalk.red);
  }
  writeLog(log);
}

export function strError(message: string) {
  let log = {
    ts: dayjs().format(),
    level: 'ERROR',
    message: message
  }
  if (LOG_LEVEL >= LogLevel.ERROR) {
    printLog(log, chalk.red);
  }
  writeLog(log);
}

export function warning(message: string) {
  let log = {
    ts: dayjs().format(),
    level: 'WARNING',
    message: message
  }
  if (LOG_LEVEL >= LogLevel.WARNING) {
    printLog(log, chalk.yellow);
  }
  writeLog(log);
}

export function info(message: string) {
  let log = {
    ts: dayjs().format(),
    level: 'INFO',
    message: message
  }
  if (LOG_LEVEL >= LogLevel.INFO) {
    printLog(log, chalk.whiteBright);
  }
  writeLog(log);
}

export function debug(message: string) {
  let log = {
    ts: dayjs().format(),
    level: 'DEBUG',
    message: message
  }
  if (LOG_LEVEL >= LogLevel.DEBUG) {
    printLog(log, chalk.whiteBright.dim);
    writeLog(log);
  }
}

export function verbose(message: string) {
  let log = {
    ts: dayjs().format(),
    level: 'VERBOSE',
    message: message
  }
  if (LOG_LEVEL >= LogLevel.VERBOSE) {
    printLog(log, chalk.white.dim);
    writeLog(log);
  }
}

function writeLog(l: Log) {
  const log = formatLog(l);
  if (LOG_FILE.length > 0) {
    fs.writeFile(LOG_FILE, log + '\n', { flag: 'a' }, (err) => {
      if (err) {
        console.log(err);
      }
    });
  }
}

function formatLog(l: Log) {
  return `[${l.level} ${l.ts}] ${l.message}${l.stack ? '\n' + l.stack : ''}`;
}

function printLog(l: Log, color: ChalkInstance) {
  console.log(color(formatLog(l)));
}
