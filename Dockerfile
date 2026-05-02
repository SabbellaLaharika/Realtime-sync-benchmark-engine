FROM node:18-slim

RUN apt-get update && apt-get install -y curl iproute2 iputils-ping && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]
