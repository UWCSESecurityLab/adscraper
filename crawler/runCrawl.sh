#!/bin/bash

# Read jobSpec from stdin (passed from amqp)
jobspec=$(cat)

# Parse out profile flags
useExistingProfile=$(echo $jobspec | jq ".profileOptions.useExistingProfile")
writeProfile=$(echo $jobspec | jq ".profileOptions.writeProfile")
profileDir=$(echo $jobspec | jq -r ".profileOptions.profileDir")
newProfileDir=$(echo $jobspec | jq -r ".profileOptions.newProfileDir")

if [[ $useExistingProfile = true && ! -d "$profileDir" ]]; then
  echo "Error: no directory exists at $profileDir"
  exit 1
fi

if [[ $writeProfile = true && -d "$newProfileDir" ]]; then
  echo "Error: $newProfileDir already exists, this would be overwritten"
  exit 1
fi


if [[ $useExistingProfile = true ]];
then
  echo "Copying profile from ${profileDir} to container"
  # TODO: rsync profile from mounted network drive location to container-local storage
  rsync -a ${profileDir}/ /home/node/chrome_profile
fi

echo "Running crawler"

# Run crawler
node gen/crawler-amqp.js <<< "$jobspec"

if [[ $writeProfile = true ]];
then
  if [[ $newProfileDir = null ]]; then
    echo "Writing profile to temp location (${profileDir}-temp)"
    # rsync updated profile to temp location in mounted network drive
    rsync -a /home/node/chrome_profile/ ${profileDir}-temp

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
    rsync -a /home/node/chrome_profile/ $newProfileDir
  fi
fi
