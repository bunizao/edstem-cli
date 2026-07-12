FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 CMD ["bun", "-e", "fetch('http://127.0.0.1:8787/readyz').then((response) => { if (!response.ok) throw new Error(String(response.status)); }).catch(() => process.exit(1))"]
CMD ["bun", "dist/remote/index.js"]
