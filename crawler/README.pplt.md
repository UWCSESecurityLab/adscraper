# Pre-requisite

Make sure you have Nodejs (and npm) installed

You can download the installer from - https://nodejs.org/en/download/

or if you are on a mac, you can do -

```shell
brew install node
```

# Create .env file
Create a .env file with the following contents in this 'crawler' directory -

```shell
MASTER_PASSWORD=<master-password-given-to-you>
PROFILE=<profile-you-want-to-run>
```

Profile can be one of the following -

```shell
all_industries
books_and_literature
childrens_health
consumer_electronics
insurance
performing_arts
pet_supplies
real_estate
streaming_and_online_tv
travel_and_tourism
vehicles
```

## Install dependencies
```shell
npm install
```

## Running the app

```shell
npm run ads
```