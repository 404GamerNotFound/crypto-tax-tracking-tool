FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY client ./client
RUN npm run build:ledger

COPY server.js ./
COPY lib ./lib

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

RUN mkdir -p /data && chown -R node:node /app /data

USER node
VOLUME ["/data"]
EXPOSE 3000

CMD ["npm", "start"]
