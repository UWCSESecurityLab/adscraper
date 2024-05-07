#!/bin/bash

# set -e

# Read jobSpec from stdin (passed from amqp)
crawlSpec=$(cat)

function parseError() {
  echo "Encountered error parsing crawlspec: (Error $?)" | tee -a $logFile
  exit 242
}

# Parse necessary fields from crawl spec
jobId=$(echo $crawlspec | jq -r ".jobId") || parseError
crawlName=$(echo $crawlspec | jq -r ".crawlName") || parseError
outputDir=$(echo $crawlspec | jq -r ".outputDir") || parseError
useExistingProfile=$(echo $crawlspec | jq ".profileOptions.useExistingProfile") || parseError
writeProfile=$(echo $crawlspec | jq ".profileOptions.writeProfile") || parseError
profileDir=$(echo $crawlspec | jq -r ".profileOptions.profileDir") || parseError
newProfileDir=$(echo $crawlspec | jq -r ".profileOptions.newProfileDir") || parseError
sshHost=$(echo $crawlspec | jq -r ".profileOptions.sshHost") || parseError
sshRemotePort=$(echo $crawlspec | jq -r ".profileOptions.sshRemotePort") || parseError
sshKey=$(echo $crawlspec | jq -r ".profileOptions.sshKey") || parseError

logDir="${outputDir}"/logs/job"${jobId}"
logFile="${logDir}"/"${crawlName}".txt

mkdir -p $logDir

# Check if profile directory exists
if [[ $useExistingProfile = true && ! -d "$profileDir" ]]; then
  echo "Warning: no directory exists at $profileDir, creating directory" | tee -a $logFile
  mkdir -p $profileDir
fi

# Check if profile directory would be overwritten
if [[ $writeProfile = true && -d "$newProfileDir" ]]; then
  echo "Error: $newProfileDir already exists, this would be overwritten" | tee -a $logFile
  exit 242
fi

# Start SSH tunnel for proxying
if [[ ! "${sshHost}" = "null" && ! "${sshKey}" = "null" && ! "${sshRemotePort}" = "null" ]]; then
  echo "Starting ssh tunnel" | tee -a $logFile

  # Copy ssh keys into container to avoid permissions issues
  mkdir -p /home/pptruser/.ssh
  chmod 700 /home/pptruser/.ssh
  cp $sshKey /home/pptruser/.ssh/id_rsa
  cp "${sshKey}.pub" /home/pptruser/.ssh/id_rsa.pub
  chmod 600 /home/pptruser/.ssh/id_rsa
  chmod 644 /home/pptruser/.ssh/id_rsa.pub
  chown -R pptruser:pptruser /home/pptruser/.ssh

  ssh -f -N -o StrictHostKeyChecking=no -i /home/pptruser/.ssh/id_rsa -D 5001 -p $sshRemotePort $sshHost || {
    echo "SSH tunnel failed to start (Error $?)" | tee -a $logFile
    exit 243
  }
fi

# Copy profile to container
if [[ $useExistingProfile = true ]];
then
  echo "Copying profile from ${profileDir} to container"
  # TODO: rsync profile from mounted network drive location to container-local storage
  rsync -a --no-links ${profileDir}/ /home/pptruser/chrome_profile || {
    echo "Copying to container via rsync failed (Error $?)" | tee -a $logFile
    exit 245
  }
fi

echo "Running crawler" | tee -a $logFile

# Run crawler
node gen/crawler-amqp.js <<< "$crawlspec"
crawl_exit_code=$?

if [[ $crawl_exit_code -ne 0 ]]; then
  echo "Crawler process failed with exit code $crawl_exit_code" | tee -a $logFile
fi

# Write profile back to originating volume (even if an error occurred, so that
# progress on crawling can be saved). But does not overwrite if an input or
# unretryable error occurs, as that may result in overwriting a profile with
# and empty directory.
if [[ $writeProfile = true && $crawl_exit_code -ne 242 && $crawl_exit_code -ne 243 ]];
then
  if [[ $newProfileDir = null ]]; then
    echo "Writing profile to temp location (${profileDir}-temp)" | tee -a $logFile
    # rsync updated profile to temp location in mounted network drive
    rsync -a --no-links /home/pptruser/chrome_profile/ ${profileDir}-temp || {
      echo "Writing to temp location via rsync failed (Error $?)" | tee -a $logFile
      echo "Exiting container with code 245 (run script error)" | tee -a $logFile
      exit 245
    }

    echo "Deleting old profile" | tee -a $logFile
    # delete old profile
    rm -rf $profileDir

    echo "Renaming temp profile to old profile's name (${profileDir})" | tee -a $logFile
    # rename temp profile to old profile
    mv ${profileDir}-temp $profileDir
  else
    echo "Writing profile to ${newProfileDir}" | tee -a $logFile
    mkdir -p ${newProfileDir}
    # rsync profile to new profile dir
    rsync -a --no-links /home/pptruser/chrome_profile/ $newProfileDir || {
      echo "Writing to new profile location via rsync failed (Error $?)" | tee -a $logFile
      echo "Exiting container with code 245 (run script error)" | tee -a $logFile
      exit 245
    }
  fi
fi

if [[ $crawl_exit_code -ne 0 ]]; then
  echo "Container completed with crawl error, terminating with exit code $crawl_exit_code" | tee -a $logFile
  exit $crawl_exit_code
else
  echo "Container completed with no errors" | tee -a $logFile
fi
