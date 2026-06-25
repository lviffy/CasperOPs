# syntax=docker/dockerfile:1.7
#
# CasperOPs Casper backend — multi-stage production image.
#
# Stage 1 (deps):   npm ci with dev deps so c8 / nodemon are available for the
#                   test stage. Only production deps get copied into the
#                   runtime image so we don't ship nodemon / c8 to prod.
# Stage 2 (runtime):node:20-alpine, non-root user, tini for clean SIGTERM,
#                   HEALTHCHECK against /health/live, exposes port 3000.

ARG NODE_VERSION=20-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Copy lockfile + package.json first so dependency layer is cached when only
# source changes.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── Stage 2: production runtime ──────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn \
    PORT=3000

# Install tini so SIGTERM from `docker stop` reaches the Node process and
# our gracefulShutdown() handler runs cleanly.
RUN apk add --no-cache tini

# Copy only the production node_modules from the deps stage (skip devDeps).
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server.js ./
COPY app.js ./
COPY config ./config
COPY controllers ./controllers
COPY middleware ./middleware
COPY routes ./routes
COPY services ./services
COPY utils ./utils
COPY contracts ./contracts 2>/dev/null || true

# Non-root user. node:alpine ships with a `node` user already.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]