# Aweborn sync-service
#
# Build context is the REPO ROOT (the service imports ../../../shared):
#   docker build -f server/sync-service/Dockerfile -t ghcr.io/aweborn/sync-service:latest .
#
# Layout inside the image mirrors the repo so relative imports resolve:
#   /app/shared/...                  (compiled → dist/shared/...)
#   /app/server/sync-service/...     (compiled → dist/server/sync-service/...)

# ── Build stage (also used by docker compose for hot-reload dev) ──────
FROM node:22-alpine AS builder

# Build tools for native modules (better-sqlite3 → node-gyp)
RUN apk add --no-cache python3 make g++

WORKDIR /app/server/sync-service

COPY server/sync-service/package.json server/sync-service/package-lock.json ./
RUN npm ci

COPY server/sync-service/tsconfig.json ./
COPY server/sync-service/src ./src
COPY server/sync-service/scripts ./scripts
COPY shared /app/shared

RUN npx tsc

# ── Production stage ──────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app/server/sync-service

RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Reuse the compiled native module from the builder; drop dev deps.
COPY --from=builder /app/server/sync-service/package.json /app/server/sync-service/package-lock.json ./
COPY --from=builder /app/server/sync-service/node_modules ./node_modules
RUN npm prune --omit=dev && npm cache clean --force
COPY --from=builder /app/server/sync-service/dist ./dist

USER appuser
EXPOSE 1234
# DB_PATH must point at a persistent volume (see infra/k3s/sync-service-deployment.yaml)
ENV PORT=1234 HOST=0.0.0.0 NODE_ENV=production DB_PATH=/data/universe.db
CMD ["node", "dist/server/sync-service/src/index.js"]
