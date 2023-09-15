FROM node:18

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

EXPOSE 80
CMD [ "node", "gen/jobServer.js" ]

# docker build . -t job-server
