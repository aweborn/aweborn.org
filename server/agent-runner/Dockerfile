# ── Build stage ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Build tools for native modules (better-sqlite3 → node-gyp)
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Production stage ──────────────────────────────────────────────────
FROM node:22-alpine

# Build tools for native modules (needed at install time)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Data directory for SQLite
RUN mkdir -p /app/data && chown appuser:appgroup /app/data

USER appuser
EXPOSE 3002
ENV PORT=3002 HOST=0.0.0.0 NODE_ENV=production DATA_DIR=/app/data

CMD ["node", "dist/index.js"]
