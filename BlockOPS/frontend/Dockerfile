# syntax=docker/dockerfile:1.7
#
# BlockOps frontend — multi-stage Next.js standalone build.
#
# Stage 1 (deps):       install full deps for the build (need typescript,
#                       tailwind, etc.).
# Stage 2 (builder):    run `next build` to produce the standalone bundle.
# Stage 3 (runtime):    copy only the standalone output + static + public
#                       dirs into a slim node:20-alpine image. Non-root,
#                       tini for clean SIGTERM, HEALTHCHECK on port 3000.

ARG NODE_VERSION=20-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── Stage 2: build ───────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env vars consumed by `next build` / `@sentry/nextjs`.
# `NEXT_PUBLIC_*` must be set here; server-only secrets should be runtime.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_CASPER_RPC_URL
ARG NEXT_PUBLIC_AGENT_FACTORY_HASH
ARG NEXT_PUBLIC_REPUTATION_HASH
ARG NEXT_PUBLIC_ESCROW_HASH
ARG NEXT_PUBLIC_COMPLIANCE_HASH
ARG NEXT_PUBLIC_AGENT_BACKEND_URL=http://localhost:8000
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_CASPER_RPC_URL=${NEXT_PUBLIC_CASPER_RPC_URL} \
    NEXT_PUBLIC_AGENT_FACTORY_HASH=${NEXT_PUBLIC_AGENT_FACTORY_HASH} \
    NEXT_PUBLIC_REPUTATION_HASH=${NEXT_PUBLIC_REPUTATION_HASH} \
    NEXT_PUBLIC_ESCROW_HASH=${NEXT_PUBLIC_ESCROW_HASH} \
    NEXT_PUBLIC_COMPLIANCE_HASH=${NEXT_PUBLIC_COMPLIANCE_HASH} \
    NEXT_PUBLIC_AGENT_BACKEND_URL=${NEXT_PUBLIC_AGENT_BACKEND_URL}

RUN npm run build

# ── Stage 3: runtime ────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apk add --no-cache tini

# Non-root user.
USER node

# Copy standalone bundle + static + public. The standalone build already
# traces the JS file graph so node_modules here is the minimum needed to
# run the server.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]