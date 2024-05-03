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
sshHost=$(echo $jobspec | jq -r ".profileOptions.sshHost") || parseError
sshRemotePort=$(echo $jobspec | jq -r ".profileOptions.sshRemotePort") || parseError
sshKey=$(echo $jobspec | jq -r ".profileOptions.sshKey") || parseError

# Check if profile directory exists
if [[ $useExistingProfile = true && ! -d "$profileDir" ]]; then
  echo "Warning: no directory exists at $profileDir, creating directory"
  mkdir -p $profileDir
fi

# Check if profile directory would be overwritten
if [[ $writeProfile = true && -d "$newProfileDir" ]]; then
  echo "Error: $newProfileDir already exists, this would be overwritten"
  exit 1
fi

# Start SSH tunnel for proxying
if [[ ! "${sshHost}" = "null" && ! "${sshKey}" = "null" && ! "${sshRemotePort}" = "null" ]]; then
  echo "Starting ssh tunnel"
  echo $sshHost
  echo $sshRemotePort
  echo $sshKey

  # Copy ssh keys into container to avoid permissions issues
  mkdir -p /home/pptruser/.ssh
  chmod 700 /home/pptruser/.ssh
  cp $sshKey /home/pptruser/.ssh/id_rsa
  cp "${sshKey}.pub" /home/pptruser/.ssh/id_rsa.pub
  chmod 600 /home/pptruser/.ssh/id_rsa
  chmod 644 /home/pptruser/.ssh/id_rsa.pub
  chown -R pptruser:pptruser /home/pptruser/.ssh

  ssh -f -N -o StrictHostKeyChecking=no -i /home/pptruser/.ssh/id_rsa -D 5001 -p $sshRemotePort $sshHost || {
    echo "SSH tunnel failed to start (Error $?)"
    exit 1
  }
fi

# Copy profile to container
if [[ $useExistingProfile = true ]];
then
  echo "Copying profile from ${profileDir} to container"
  # TODO: rsync profile from mounted network drive location to container-local storage
  rsync -a --no-links ${profileDir}/ /home/pptruser/chrome_profile || {
    echo "Copying to container via rsync failed (Error $?)"
    exit 1
  }
fi

echo "Running crawler"

# Run crawler
node gen/crawler-amqp.js <<< "$jobspec" || echo "Crawler process failed with exit code $?"

# Write profile back to originating volume
if [[ $writeProfile = true ]];
then
  if [[ $newProfileDir = null ]]; then
    echo "Writing profile to temp location (${profileDir}-temp)"
    # rsync updated profile to temp location in mounted network drive
    rsync -a --no-links /home/pptruser/chrome_profile/ ${profileDir}-temp || {
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
    rsync -a --no-links /home/pptruser/chrome_profile/ $newProfileDir || {
      echo "Writing to new profile location via rsync failed (Error $?), aborting"
      exit 1
    }
  fi
fi
echo "Done!"
