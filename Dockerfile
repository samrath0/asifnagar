#Sample Dockerfile for NodeJS Apps

FROM node:latest
# Set environment variables
ENV NODE_ENV=production
ENV MONGO_URI
ENV RAZORPAY_KEY_ID
ENV RAZORPAY_KEY_SECRET

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install --production

COPY . .

EXPOSE 3000

CMD [ "node", "server.js" ]
