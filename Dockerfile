# syntax=docker/dockerfile:1
#
# Maysan Labs production image for KeeLead.
#
# Why this differs from upstream's Dockerfile:
#   * upstream's runtime stage copies /app/.next/standalone, but next.config.js never set
#     `output: 'standalone'`, so `next build` never produced that directory and the image
#     could not be built at all (Docker COPY of a missing path is a hard failure);
#   * the base is Debian, not Alpine, so the Prisma query engine generated in the builder
#     matches the libc of the runtime image (a musl engine cannot run on glibc);
#   * the Prisma CLI stays in the runtime image, because the entrypoint applies the schema
#     to the SQLite file on the volume on every start;
#   * Chromium is installed with the exact playwright version the app resolved, so the
#     Playwright-backed data sources actually work;
#   * the SQLite database lives in /app/data — a path that does NOT shadow /app/prisma,
#     so the schema and the database can never be confused for one another.

ARG NODE_IMAGE=node:20-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# openssl is not in bookworm-slim, and without libssl Prisma cannot detect the platform
# and loads the wrong query engine (or tries to download one it cannot write).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* is inlined into the client bundle at build time — a runtime env change
# does not affect it, so it arrives here as a build arg.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_TELEMETRY_DISABLED=1
RUN node node_modules/prisma/build/index.js generate
RUN npm run build
RUN date -u +%Y-%m-%dT%H:%M:%SZ > /app/BUILD_TIME

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/app/ms-playwright \
    DATABASE_URL=file:/app/data/keelead.db

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --create-home nextjs

# Same reason as the deps stage: the Prisma query engine links libssl.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/BUILD_TIME ./BUILD_TIME
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Prisma CLI + engines (the entrypoint runs `prisma db push`).
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Playwright: the browser binary plus the OS libraries it needs, installed as root and
# shared via PLAYWRIGHT_BROWSERS_PATH so the runtime user can read them.
COPY --from=builder /app/node_modules/playwright ./node_modules/playwright
COPY --from=builder /app/node_modules/playwright-core ./node_modules/playwright-core
RUN node node_modules/playwright/cli.js install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/data \
 && chown -R nextjs:nodejs /app/data /app/ms-playwright /app/prisma /app/node_modules

USER nextjs
EXPOSE 3000

# `db push` is idempotent against an in-sync database. It is deliberately run WITHOUT
# --accept-data-loss: a schema change that would destroy lead rows fails loudly at start-up
# instead of silently wiping the database.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js db push --skip-generate --schema=/app/prisma/schema.prisma && node server.js"]
