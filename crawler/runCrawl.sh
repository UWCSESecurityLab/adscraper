#!/bin/bash

# set -e

# Read jobSpec from stdin (passed from amqp)
jobspec=$(cat)

function parseError() {
  echo "Encountered error parsing jobspec: (Error $?)"
  exit 1
}

# Parse out profile flags
useExistingProfile=$(echo $jobspec | jq ".profileOptions.useExistingProfile") || parseError
writeProfile=$(echo $jobspec | jq ".profileOptions.writeProfile") || parseError
profileDir=$(echo $jobspec | jq -r ".profileOptions.profileDir") || parseError
newProfileDir=$(echo $jobspec | jq -r ".profileOptions.newProfileDir") || parseError

if [[ $useExistingProfile = true && ! -d "$profileDir" ]]; then
  echo "Warning: no directory exists at $profileDir, creating directory"
  mkdir -p $profileDir
fi

if [[ $writeProfile = true && -d "$newProfileDir" ]]; then
  echo "Error: $newProfileDir already exists, this would be overwritten"
  exit 1
fi


if [[ $useExistingProfile = true ]];
then
  echo "Copying profile from ${profileDir} to container"
  # TODO: rsync profile from mounted network drive location to container-local storage
  rsync -a --no-links ${profileDir}/ /home/node/chrome_profile || {
    echo "Copying to container via rsync failed (Error $?)"
    exit 1
  }
fi

echo "Running crawler"

# Run crawler
node gen/crawler-amqp.js <<< "$jobspec" || echo "Crawler process failed with exit code $?"

if [[ $writeProfile = true ]];
then
  if [[ $newProfileDir = null ]]; then
    echo "Writing profile to temp location (${profileDir}-temp)"
    # rsync updated profile to temp location in mounted network drive
    rsync -a --no-links /home/node/chrome_profile/ ${profileDir}-temp || {
      echo "Writing to temp location via rsync failed (Error $?), aborting"
      exit 1
    }

    echo "Deleting old profile"
    # delete old profile
    rm -rf $profileDir

    echo "Renaming temp profile to old profile's name (${profileDir})"
    # rename temp profile to old profile
    mv ${profileDir}-temp $profileDir
  else
    echo "Writing profile to ${newProfileDir}"
    mkdir -p ${newProfileDir}
    # rsync profile to new profile dir
    rsync -a --no-links /home/node/chrome_profile/ $newProfileDir || {
      echo "Writing to new profile location via rsync failed (Error $?), aborting"
      exit 1
    }
  fi
fi
