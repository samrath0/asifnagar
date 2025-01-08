#Sample Dockerfile for NodeJS Apps

FROM node:latest
# Set environment variables
ENV NODE_ENV=production
ENV MONGO_URI="your_mongo_connection_string"
ENV RAZORPAY_KEY_ID="your_razorpay_key_id"
ENV RAZORPAY_KEY_SECRET="your_razorpay_key_secret"

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install --production

COPY . .

EXPOSE 3000

CMD [ "node", "server.js" ]
