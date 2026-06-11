FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server source
COPY . .

# Expose the port Railway will assign via $PORT
EXPOSE 3001

CMD ["node", "server.js"]
