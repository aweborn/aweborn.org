# ── Build stage ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Build tools for native modules (better-sqlite3 → node-gyp)
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

# shared/ types are COPYed from the build context (see docker build -f ... context)
# For docker compose dev mode, this is volume-mounted instead.
# The tsc build is only run in production (via CI/deploy script).
# For now, skip tsc — dev uses tsx watch with volume mounts.

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

# Copy source for tsx (dev) or compiled dist (production)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./

USER appuser
EXPOSE 1234
ENV PORT=1234 HOST=0.0.0.0 NODE_ENV=production

CMD ["node", "dist/index.js"]
