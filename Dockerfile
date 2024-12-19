#Sample Dockerfile for NodeJS Apps

FROM node:v23.3.0

ENV NODE_ENV=production

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install --production

COPY . .

EXPOSE 8080

CMD [ "node", "server.js" ]