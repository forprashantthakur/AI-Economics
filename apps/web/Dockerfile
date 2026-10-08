# syntax=docker/dockerfile:1.7
# Enterprise AI Economics Studio — web image (static Vite build served by nginx).
# Build from the repository root (the web app imports the @aies/engine and @aies/reports workspaces):
#   docker build -f apps/web/Dockerfile -t aies-web .

# ── build
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/reports/package.json packages/reports/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# The lockfile carries the musl builds of the native toolchain (rolldown, lightningcss, tailwind oxide).
RUN --mount=type=cache,target=/root/.npm \
    npm ci -w @aies/web --include-workspace-root --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY packages/reports packages/reports
COPY apps/web apps/web
RUN rm -rf apps/web/dist && npm run build -w @aies/web

# ── runtime
FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
