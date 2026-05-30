# Hermes — production container
FROM node:20-slim

# better-sqlite3 needs build tools for its native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm install

# Copy source and build the production bundle (server + single-file dashboard)
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=5000
# Persist SQLite into the mounted volume at /app/data
ENV HERMES_DB_PATH=/app/data/data.db
RUN mkdir -p /app/data

EXPOSE 5000

CMD ["npm", "run", "start"]
