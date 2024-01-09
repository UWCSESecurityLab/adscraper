#/bin/bash

# Read jobSpec from stdin (passed from amqp)
jobspec=$(cat)

# Parse out profile flags
useExistingProfile=$(echo $jobspec | jq ".profileOptions.useExistingProfile")
writeProfile=$(echo $jobspec | jq ".profileOptions.writeProfile")
profileDir=$(echo $jobspec | jq ".profileOptions.profileDir")
newProfileDir=$(echo $jobspec | jq ".profileOptions.newProfileDir")

if [[ "$useExistingProfile" = "true" && ! -d $profileDir ]]; then
  echo "Error: could not read directory at profileDir"
  exit 1
fi

if [[ "$writeProfile" = "true" && -d $newProfileDir ]]; then
  echo "Error: newProfileDir already exists, this would be overwritten"
  exit 1
fi


if [[ "$useExistingProfile" = "true" ]];
then
  # TODO: rsync profile from mounted network drive location to container-local storage
  rsync -a "${profileDir}/" /home/pptruser/chrome_profile
fi

# Run crawler
node gen/crawler-amqp.js <<< "$jobspec"

if [[ "writeProfile" = "true" ]];
then
  if [[ -n "newProfileDir" ]];
  then
    # rsync profile to new profile dir
    rsync -a /home/pptruser/chrome_profile/ $newProfileDir
  else
    # rsync updated profile to temp location in mounted network drive
    rsync -a /home/pptruser/chrome_profile/ "${profileDir}-temp"
    # delete old profile
    rm -rf $profileDir
    # rename temp profile to old profile
    mv "${profileDir}-temp" $profileDir
  fi
fi
