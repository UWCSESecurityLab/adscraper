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
  var LOG_FILE_STREAM: fs.WriteStream | undefined;
  var LOG_LEVEL: LogLevel;
}

globalThis.LOG_FILE_STREAM = undefined;
globalThis.LOG_LEVEL = LogLevel.INFO;

// Call to set where log files should be stored - directory structure and
// name are based on the job id and crawl name. If not called, no logs will
// be written to file.
export function setLogDirFromFlags(crawlerFlags: CrawlerFlags) {
  if (LOG_FILE_STREAM) {
    console.log('Log file already open');
    return;
  }

  let logDirSegments = [crawlerFlags.outputDir, 'logs'];
  if (crawlerFlags.jobId) {
    logDirSegments.push(`job_${crawlerFlags.jobId.toString()}`);
  }
  let logDir = path.resolve(...logDirSegments);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  let logFile = path.resolve(logDir, `${crawlerFlags.crawlName}.txt`);
  console.log('Opening log file at ' + logFile);
  globalThis.LOG_FILE_STREAM = fs.createWriteStream(logFile, { flags: 'a' })
  globalThis.LOG_LEVEL = crawlerFlags.logLevel ? crawlerFlags.logLevel : LogLevel.INFO;
}

export function error(e: Error, url?: string) {
  let log = {
    ts: dayjs().format(),
    level: 'ERROR',
    message: `${url? url + ': ': ''}${e.message}`,
    stack: e.stack
  }
  let logStr = formatLog(log);
  if (LOG_LEVEL >= LogLevel.ERROR) {
    printLog(logStr, chalk.red);
  }
  writeLog(logStr);
}

export function strError(message: string) {
  let log = {
    ts: dayjs().format(),
    level: 'ERROR',
    message: message
  }
  let logStr = formatLog(log);
  if (LOG_LEVEL >= LogLevel.ERROR) {
    printLog(logStr, chalk.red);
  }
  writeLog(logStr);
}

export function warning(message: string) {
  let log = {
    ts: dayjs().format(),
    level: 'WARNING',
    message: message
  }
  let logStr = formatLog(log);
  if (LOG_LEVEL >= LogLevel.WARNING) {
    printLog(logStr, chalk.yellow);
  }
  writeLog(logStr);
}

export function info(message: string) {
  let log = {
    ts: dayjs().format(),
    level: 'INFO',
    message: message
  }
  let logStr = formatLog(log);
  if (LOG_LEVEL >= LogLevel.INFO) {
    printLog(logStr, chalk.whiteBright);
  }
  writeLog(logStr);
}

export function debug(message: string) {
  let log = {
    ts: dayjs().format(),
    level: 'DEBUG',
    message: message
  }
  if (LOG_LEVEL >= LogLevel.DEBUG) {
    let logStr = formatLog(log);
    printLog(logStr, chalk.whiteBright.dim);
    writeLog(logStr);
  }
}

export function verbose(message: string) {
  let log = {
    ts: dayjs().format(),
    level: 'VERBOSE',
    message: message
  }
  if (LOG_LEVEL >= LogLevel.VERBOSE) {
    let logStr = formatLog(log);
    printLog(logStr, chalk.white.dim);
    writeLog(logStr);
  }
}

function writeLog(l: string) {
  if (LOG_FILE_STREAM) {
    LOG_FILE_STREAM.write(l + '\n');
  }
}

function formatLog(l: Log) {
  return `[${l.level} ${l.ts}] ${l.message}${l.stack ? '\n' + l.stack : ''}`;
}

function printLog(l: string, color: ChalkInstance) {
  console.log(color(l));
}
