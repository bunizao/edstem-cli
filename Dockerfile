FROM oven/bun:1 AS bun-runtime

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build:local && npm run build:remote

FROM bun-runtime AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/dist ./dist
RUN mkdir -p /data && chown bun:bun /data

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 CMD ["bun", "-e", "fetch('http://127.0.0.1:8787/readyz').then((response) => { if (!response.ok) throw new Error(String(response.status)); }).catch(() => process.exit(1))"]
USER bun
CMD ["bun", "dist/remote/index.js"]
