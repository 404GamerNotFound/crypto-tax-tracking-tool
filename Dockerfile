FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium

COPY public ./public
COPY client ./client
RUN npm run build:ledger

COPY server.js ./
COPY lib ./lib
COPY scripts ./scripts

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    CRYPTOBUCH_HTTPS=true

RUN mkdir -p /data && chown -R node:node /app /data /ms-playwright

USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node scripts/healthcheck.js

CMD ["npm", "start"]
