# Single process, no database, no build step.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install deps first so this layer caches between code changes.
COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

# Rooms live in memory, so one instance serves one set of games.
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
