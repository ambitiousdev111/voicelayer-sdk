FROM node:20-slim

WORKDIR /app

# better-sqlite3 requires Python + build tools to compile from source
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies (use npm install — no lock file required)
COPY package.json ./
RUN npm install --omit=dev

# Copy server source
COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
