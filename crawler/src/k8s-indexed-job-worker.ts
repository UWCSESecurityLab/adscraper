// This script runs an adscraper as a worker in a Kubernetes indexed job.
// This is the entrypoint of the container defined by Dockerfile.indexed.
// It reads the crawler flags from a file based on the job completion index
// assigned by Kubernetes, and runs the crawl.
import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';
import fs from 'fs';
import { Validator } from 'jsonschema';
import { exec } from 'node:child_process';
import path from 'path';
import * as url from 'url';
import util from 'util';
import * as crawler from './crawler.js';
import DbClient from './util/db.js';
import { ExitCodes, InputError, NonRetryableError } from './util/errors.js';
import * as log from './util/log.js';

let execPromise = util.promisify(exec);
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const optionsDefinitions: commandLineUsage.OptionDefinition[] = [
  {
    name: 'help',
    alias: 'h',
    type: Boolean,
    description: 'Display this usage guide.',
    group: 'main'
  },
  {
    name: 'job_id',
    alias: 'j',
    type: Number,
    description: 'Job ID of this crawl',
  },
  {
    name: 'index',
    alias: 'i',
    type: String,
    description: 'Job completion index (index of crawl flags file)'
  }
];
const options = commandLineArgs(optionsDefinitions)._all;
const usage = commandLineUsage([
  {
    header: 'Adscraper amqp runner',
    content: 'Runs the adscraper crawler, by pulling inputs from an amqp message queue. Entrypoint for containers launched by the Kubernetes crawl cluster.'
  },
  {
    header: 'Options',
    optionList: optionsDefinitions
  }
]);

if (options.help) {
  console.log(usage);
  process.exit(0);
}

function validateCrawlSpec(input: any) {
  console.log(input);
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'crawlerFlagsSchema.json')).toString());
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
    if (!options.job_id) {
      log.strError('Invalid job id: ' + options.job_id)
      process.exit(ExitCodes.INPUT_ERROR);
    }
    if (!options.index) {
      log.strError('Job completion index not provided');
      process.exit(ExitCodes.INPUT_ERROR);
    }
    const crawlFile = `/home/pptruser/data/job${options.job_id}/crawl_inputs/crawl_input_${options.index}.json`;
    if (!fs.existsSync(crawlFile)) {
      log.strError(`Could not find crawl file at ${crawlFile}`);
      process.exit(ExitCodes.INPUT_ERROR);
    }
    let raw = fs.readFileSync(crawlFile).toString();

    // Parse the crawl message, set up logger
    let validated = validateCrawlSpec(JSON.parse(raw));
    if (!validated) {
      log.strError('Crawl flags did not pass validation');
      process.exit(ExitCodes.INPUT_ERROR);
    }
    let flags: crawler.CrawlerFlags = validated;
    log.setLogDirFromFlags(flags);

    // Set up database connection
    let pgConf = {
      host: process.env.PG_HOST,
      port: parseInt(process.env.PG_PORT!),
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE
    };
    const db = await DbClient.initialize(pgConf);

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
    if (flags.profileOptions.useExistingProfile && !fs.existsSync(flags.profileOptions.profileDir)) {
      fs.mkdirSync(flags.profileOptions.profileDir, { recursive: true });
    }

    // If writing a profile to a different location than it is read,
    // check to make sure it won't overwrite anything
    if (flags.profileOptions.writeProfile && fs.existsSync(flags.profileOptions.newProfileDir)) {
      log.strError(`${flags.profileOptions.newProfileDir} already exists, this would be overwritten`);
      process.exit(ExitCodes.INPUT_ERROR);
    }

    if (flags.profileOptions.sshHost && flags.profileOptions.sshRemotePort && flags.profileOptions.sshRemotePort) {
      log.info('Setting up SSH tunnel');
      // Copy SSH keys to container home dir, set permissions to prevent errors
      fs.mkdirSync('/home/pptruser/.ssh', { recursive: true });
      fs.chmodSync('/home/pptruser/.ssh', 0o700);
      fs.copyFileSync(flags.profileOptions.sshKey, '/home/pptruser/.ssh/id_rsa');
      fs.copyFileSync(`${flags.profileOptions.sshKey}.pub`, '/home/pptruser/.ssh/id_rsa.pub');
      fs.chmodSync('/home/pptruser/.ssh/id_rsa', 0o600);
      fs.chmodSync('/home/pptruser/.ssh/id_rsa.pub', 0o644);
      fs.chownSync('/home/pptruser/.ssh', 999, 999);
      fs.chownSync('/home/pptruser/.ssh/id_rsa', 999, 999);
      fs.chownSync('/home/pptruser/.ssh/id_rsa.pub', 999, 999);
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
      log.info(`Copying profile from ${flags.profileOptions.profileDir} to container`);
      fs.cpSync(flags.profileOptions.profileDir, '/home/pptruser/chrome_profile',
        { recursive: true });
    }

    async function saveProfile() {
      // Filter for fs.cpSync. Ignores the Chrome profile singletons files
      // (which are symlinks), other symlinks, or files that disappear
      // since the command was invoked.
      let filterInvalidFiles = (src: string, dst: string) => {
        if (src == 'SingletonCookie' || src == 'SingletonLock' || src == 'SingletonSocket') {
          return false;
        }
        if (!fs.existsSync(src)) {
          return false;
        }
        return !fs.lstatSync(src).isSymbolicLink();
      }

      if (!flags.profileOptions.newProfileDir) {
        log.info(`Writing profile to temp location (${flags.profileOptions.profileDir}-temp)`);
        fs.cpSync('/home/pptruser/chrome_profile', `${flags.profileOptions.profileDir}-temp`, {
          recursive: true,
          filter: filterInvalidFiles
        });
        log.info('Deleting old profile');
        fs.rmSync(flags.profileOptions.profileDir, { recursive: true });
        log.info(`Moving temp profile to original location (${flags.profileOptions.profileDir})`);
        fs.renameSync(`${flags.profileOptions.profileDir}-temp`, flags.profileOptions.profileDir);
      } else {
        log.info(`Writing profile to new location (${flags.profileOptions.newProfileDir})`);
        fs.cpSync('/home/pptruser/chrome_profile', flags.profileOptions.newProfileDir, {
          recursive: true,
          filter: filterInvalidFiles
        });
      }
    }

    let crawlSuccess = false;
    let error: Error | undefined = undefined;
    let shouldCheckpoint = flags.profileOptions.writeProfile && flags.crawlOptions.checkpointFreq;
    try {
      log.info('Running crawler...')
      await crawler.crawl(flags, pgConf, shouldCheckpoint ? saveProfile : undefined);
      log.info('Crawl succeeded');
      crawlSuccess = true;
    } catch (e: any) {
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
        const crawlIdQuery = await db.postgres.query('SELECT id FROM crawl WHERE name=$1', [flags.crawlName]);
        if (crawlIdQuery.rowCount == 0) {
          log.warning(`Could not find id for crawl ${flags.crawlName}, can't update checkpoint index (should not reach here).`)
        } else {
          await db.postgres.query(`UPDATE crawl SET last_checkpoint_index=crawl_list_current_index WHERE id=$1`,
            [crawlIdQuery.rows[0].id]);
          log.info('Successfully saved profile after crawl');
        }
      }
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
