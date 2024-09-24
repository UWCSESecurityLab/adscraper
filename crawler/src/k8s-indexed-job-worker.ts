// This script runs an adscraper as a worker in a Kubernetes indexed job.
// This is the entrypoint of the container defined by Dockerfile.indexed.
// It reads the crawler flags from a file based on the job completion index
// assigned by Kubernetes, and runs the crawl.
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { Validator } from 'jsonschema';
import { exec } from 'node:child_process';
import path from 'path';
import * as url from 'url';
import util from 'util';
import * as crawler from './crawler.js';
import DbClient from './util/db.js';
import { ExitCodes, InputError, NonRetryableError } from './util/errors.js';
import * as log from './util/log.js';
import * as tar from 'tar';

let execPromise = util.promisify(exec);
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

enum WorkerState {
  PRE_CRAWL,
  CRAWLING,
  POST_CRAWL
}
let workerState = WorkerState.PRE_CRAWL;
let terminated = false;
let interrupted = false;

async function handleTermination(signal: number) {
  let exitCode = 128 + signal;
  if (workerState == WorkerState.PRE_CRAWL) {
    log.info('Crawl has not started, exiting immediately');
    process.exit(exitCode);
  } else if (workerState == WorkerState.CRAWLING) {
    log.info('Crawl in progress, closing browser and waiting for exception...');
    await BROWSER.close();
  } else {
    log.info('Crawl has completed, doing nothing and waiting for post-crawl cleanup...');
  }
}

process.on('SIGINT', async () => {
  log.info('SIGINT received');
  interrupted = true;
  await handleTermination(2);
});

process.on('SIGTERM', async () => {
  log.info('SIGTERM received');
  terminated = true;
  await handleTermination(15);
});

async function validateCrawlSpec(input: any) {
  const buf = await fs.readFile(path.join(__dirname, 'crawlerFlagsSchema.json'));
  const schema = JSON.parse(buf.toString());
  const validator = new Validator();
  const vRes = validator.validate(input, schema);

  if (vRes.valid) {
    return input as crawler.CrawlerFlags;
  } else {
    console.log(vRes.errors.join('\n'));
    return false;
  }
}

async function main() {
  try {
    // Verify that there is a job ID so we know which queue to consume from
    if (!process.env.JOB_ID) {
      log.strError('JOB_ID environmental variable not set');
      process.exit(ExitCodes.INPUT_ERROR);
    }
    let jobId = Number(process.env.JOB_ID);

    if (!process.env.JOB_COMPLETION_INDEX) {
      log.strError('JOB_COMPLETION_INDEX environmental variable not set');
      process.exit(ExitCodes.INPUT_ERROR);
    }
    let index = Number(process.env.JOB_COMPLETION_INDEX);

    const crawlFile = `/home/pptruser/data/job_${jobId}/crawl_inputs/crawl_input_${index}.json`;
    if (!existsSync(crawlFile)) {
      log.strError(`Could not find crawl file at ${crawlFile}`);
      process.exit(ExitCodes.INPUT_ERROR);
    }
    let raw = (await fs.readFile(crawlFile)).toString();

    // Parse the crawl message, set up logger
    let validated = await validateCrawlSpec(JSON.parse(raw));
    if (!validated) {
      log.strError('Crawl flags did not pass validation');
      console.log(JSON.parse(raw));
      process.exit(ExitCodes.INPUT_ERROR);
    }
    let flags: crawler.CrawlerFlags = validated;
    log.setLogDirFromFlags(flags);

    log.info(`Starting new crawl task in job ${process.env.JOB_ID} with completion index ${process.env.JOB_COMPLETION_INDEX}`);
    log.info(JSON.stringify(flags, undefined, 2));

    // Set up database connection
    let pgConf = {
      host: process.env.PG_HOST,
      port: parseInt(process.env.PG_PORT!),
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE
    };
    let db = await DbClient.initialize(pgConf);

    // Early exit if crawl is already complete
    if (flags.resumeIfAble && flags.crawlName) {
      const prevCrawl = await db.postgres.query('SELECT * FROM crawl WHERE name=$1', [flags.crawlName]);
      let crawlExists = prevCrawl.rowCount && prevCrawl.rowCount > 0;
      if (crawlExists) {
        if (prevCrawl.rows[0].completed) {
          log.info(`Crawl with name ${flags.crawlName} is already completed, exiting`);
          process.exit(ExitCodes.OK);
        }
      }
    }

    // If loading a profile, check if profile directory exists and create an empty
    // directory if not.
    if (flags.profileOptions.useExistingProfile && !existsSync(flags.profileOptions.profileDir)) {
      log.warning(`Profile directory ${flags.profileOptions.profileDir} does not exist, creating empty directory`)
      await fs.mkdir(flags.profileOptions.profileDir, { recursive: true });
    }

    // If writing a profile to a different location than it is read,
    // check to make sure it won't overwrite anything
    if (flags.profileOptions.writeProfile && existsSync(flags.profileOptions.newProfileDir)) {
      log.strError(`${flags.profileOptions.newProfileDir} already exists, this would be overwritten`);
      process.exit(ExitCodes.INPUT_ERROR);
    }

    if (flags.profileOptions.writeProfile && flags.profileOptions.compressProfileBeforeWrite) {
      if (flags.profileOptions.newProfileDir) {
        if (!flags.profileOptions.newProfileDir.endsWith('.tar.gz')) {
          log.strError('newProfileDir must end in .tar.gz if compressProfileBeforeWrite is true');
          process.exit(ExitCodes.INPUT_ERROR);
        }
      } else {
        if (!flags.profileOptions.profileDir.endsWith('.tar.gz')) {
          log.strError('profileDir must end in .tar.gz if compressProfileBeforeWrite is true');
          process.exit(ExitCodes.INPUT_ERROR);
        }
      }
    }

    if (flags.profileOptions.sshHost && flags.profileOptions.sshRemotePort && flags.profileOptions.sshRemotePort) {
      log.info('Setting up SSH tunnel');
      // Copy SSH keys to container home dir, set permissions to prevent errors
      await fs.mkdir('/home/pptruser/.ssh', { recursive: true });
      await fs.chmod('/home/pptruser/.ssh', 0o700);
      await fs.copyFile(flags.profileOptions.sshKey, '/home/pptruser/.ssh/id_rsa');
      await fs.copyFile(`${flags.profileOptions.sshKey}.pub`, '/home/pptruser/.ssh/id_rsa.pub');
      await fs.chmod('/home/pptruser/.ssh/id_rsa', 0o600);
      await fs.chmod('/home/pptruser/.ssh/id_rsa.pub', 0o644);
      await fs.chown('/home/pptruser/.ssh', 999, 999);
      await fs.chown('/home/pptruser/.ssh/id_rsa', 999, 999);
      await fs.chown('/home/pptruser/.ssh/id_rsa.pub', 999, 999);
      try {
        let execResult = await execPromise(`ssh -f -N -o StrictHostKeyChecking=no -i /home/pptruser/.ssh/id_rsa -D 5001 -p ${flags.profileOptions.sshRemotePort} ${flags.profileOptions.sshHost}`);
        if (execResult.stderr) {
          log.strError(execResult.stderr);
        }
      } catch (e: any) {
        log.strError(`SSH tunnel failed to start (Error ${e.code}`)
        process.exit(ExitCodes.NON_RETRYABLE_ERROR);
      }
    }

    if (flags.profileOptions.useExistingProfile) {
      if (flags.profileOptions.profileDir.endsWith('.tar.gz')) {
        log.info(`Copying compressed profile from ${flags.profileOptions.profileDir} to container`);
        await fs.cp(flags.profileOptions.profileDir, '/home/pptruser/chrome_profile.tar.gz');
        log.info(`Extracting profile`)
        await tar.x({
          file: '/home/pptruser/chrome_profile.tar.gz',
          cwd: '/home/pptruser',
        });
      } else {
        log.info(`Copying profile from ${flags.profileOptions.profileDir} to container`);
        await fs.cp(flags.profileOptions.profileDir, '/home/pptruser/chrome_profile', {
          recursive: true,
          mode: fs.constants.COPYFILE_FICLONE
        });
      }
    }

    async function saveProfile() {
      // Filter for fs.cpSync. Ignores the Chrome profile singletons files
      // (which are symlinks), other symlinks, or files that disappear
      // since the command was invoked.
      let filterInvalidFiles = async (src: string, dst: string) => {
        if (src == 'SingletonCookie' || src == 'SingletonLock' || src == 'SingletonSocket') {
          return false;
        }
        if (!existsSync(src)) {
          return false;
        }
        return !(await fs.lstat(src)).isSymbolicLink();
      }

      let containerProfileLoc;
      if (flags.profileOptions.compressProfileBeforeWrite) {
        await tar.c({
          gzip: true,
          file: '/home/pptruser/chrome_profile.tar.gz'
        }, ['/home/pptruser/chrome_profile']);
        containerProfileLoc = '/home/pptruser/chrome_profile.tar.gz';
      } else {
        containerProfileLoc = '/home/pptruser/chrome_profile';
      }

      if (!flags.profileOptions.newProfileDir) {
        let tempLocation = `${flags.profileOptions.profileDir}-tmp`

        log.info(`Writing profile to temp location (${tempLocation}`);
        await fs.cp(containerProfileLoc, tempLocation, {
          recursive: true,
          filter: filterInvalidFiles
        });
        log.info('Deleting old profile');
        await fs.rm(flags.profileOptions.profileDir, { recursive: true });
        log.info(`Moving temp profile to original location (${flags.profileOptions.profileDir})`);
        await fs.rename(tempLocation, flags.profileOptions.profileDir);
      } else {
        log.info(`Writing profile to new location (${flags.profileOptions.newProfileDir})`);
        await fs.cp(containerProfileLoc, flags.profileOptions.newProfileDir, {
          recursive: true,
          filter: filterInvalidFiles
        });
      }
    }

    let crawlSuccess = false;
    let error: Error | undefined = undefined;

    let shouldCheckpoint = flags.profileOptions.writeProfile && flags.crawlOptions.checkpointFreqSeconds;
    let saveProfileCheckpoint = async () => {
      log.info('Closing browser for checkpoint...');
      await BROWSER.close();
      await saveProfile();
      globalThis.BROWSER = await crawler.launchBrowser(flags);
    }

    try {
      log.info('Running crawler...');
      workerState = WorkerState.CRAWLING;
      await crawler.crawl(flags, pgConf, shouldCheckpoint ? saveProfileCheckpoint : undefined);
      workerState = WorkerState.POST_CRAWL;
      log.info('Crawl succeeded');
      crawlSuccess = true;
    } catch (e: any) {
      workerState = WorkerState.POST_CRAWL;
      log.strError('Crawl failed due to exception:');
      if (e instanceof Error) {
        log.error(e);
      } else {
        log.strError(e);
      }
      crawlSuccess = false;
      error = e;
    }

    // If the crawl failed due to inputs, we don't need to re-save the profile
    // since the browser should not have launched and changed anything, so
    // we can exit now.
    if (!crawlSuccess) {
      if (error instanceof InputError) {
        log.info(`Container exiting (without saving profile) due to input error (exit code ${ExitCodes.INPUT_ERROR})`);
        process.exit(ExitCodes.INPUT_ERROR);
      }
    }

    // Resave the profile if requested, unless it is "nonretryable", which
    // may indicate a permissions issue or other issue that makes it unsafe
    // to restart the crawl.
    if (flags.profileOptions.writeProfile && !(error instanceof NonRetryableError)) {
      await saveProfile();
      if (shouldCheckpoint) {
        // Update last checkpoint index with the final profile save
        db = await DbClient.initialize(pgConf);
        const crawlIdQuery = await db.postgres.query('SELECT id, crawl_list_current_index FROM crawl WHERE name=$1', [flags.crawlName]);
        if (crawlIdQuery.rowCount == 0) {
          log.warning(`Could not find id for crawl ${flags.crawlName}, can't update checkpoint index (should not reach here).`)
        } else {
          await db.postgres.query(`UPDATE crawl SET last_checkpoint_index=crawl_list_current_index WHERE id=$1`,
            [crawlIdQuery.rows[0].id]);
            log.info(`Successfully saved end-of-crawl checkpoint at index ${crawlIdQuery.rows[0].crawl_list_current_index}`);
        }
      }
    }

    if (terminated) {
      log.info(`Container exiting due to SIGTERM`);
      process.exit(128 + 15);
    }
    if (interrupted) {
      log.info(`Container exiting due to SIGINT`);
      process.exit(128 + 2);
    }

    if (!crawlSuccess) {
      if (error instanceof InputError) {
        // Should not reach here
        log.info(`Container exiting due to input error (exit code ${ExitCodes.INPUT_ERROR})`);
        process.exit(ExitCodes.INPUT_ERROR);
      } else if (error instanceof NonRetryableError) {
        log.info(`Container exiting due to non-retryable error (exit code ${ExitCodes.NON_RETRYABLE_ERROR})`);
        process.exit(ExitCodes.NON_RETRYABLE_ERROR);
      } else {
        log.info(`Container exiting due to uncaught crawler error (exit code ${ExitCodes.UNCAUGHT_CRAWL_ERROR})`);
        process.exit(ExitCodes.UNCAUGHT_CRAWL_ERROR);
      }
    }
    log.info('Container completed with no errors!');
    process.exit(ExitCodes.OK);
  } catch (e: any) {
    log.strError('Uncaught container script error');
    log.error(e);
    log.info(`Container exiting due to run script error (exit code ${ExitCodes.RUN_SCRIPT_ERROR})`);
    process.exit(ExitCodes.RUN_SCRIPT_ERROR);
  }
}

main();
