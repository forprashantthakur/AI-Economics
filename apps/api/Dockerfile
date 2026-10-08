# syntax=docker/dockerfile:1.7
# Enterprise AI Economics Studio — API image.
# Build from the repository root (the API bundles the @aies/engine workspace):
#   docker build -f apps/api/Dockerfile -t aies-api .

ARG NODE_IMAGE=node:22-alpine

# ── build: install the workspace and bundle src/server.ts + src/cli.ts with esbuild
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/reports/package.json packages/reports/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm \
    npm ci -w @aies/api --include-workspace-root --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/engine/src packages/engine/src
COPY packages/reports/src packages/reports/src
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/
RUN npm run build -w @aies/api

# ── deps: production dependencies only (pg, fastify, jose, bcryptjs, zod, decimal.js, PGlite fallback)
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/reports/package.json packages/reports/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm \
    npm ci -w @aies/api --omit=dev --no-audit --no-fund \
 && rm -rf node_modules/@aies

# ── runtime
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    MIGRATIONS_DIR=/app/db/migrations
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --chown=node:node db/migrations ./db/migrations
RUN printf '{"type":"module","private":true}\n' > package.json
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# Migrations run automatically on start (advisory-locked); the CLI is available as
#   docker compose exec api node dist/cli.js <migrate|seed|create-user>
CMD ["node", "--enable-source-maps", "dist/server.js"]
