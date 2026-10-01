# syntax=docker/dockerfile:1.7
# Build context: repository root  →  docker build -f apps/crm-api/Dockerfile .

# ── 1. all deps (incl. dev) for compiling ─────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/crm-api/package.json apps/crm-api/
RUN npm ci --workspace @propflow/shared --workspace @propflow/crm-api --no-audit --no-fund

# ── 2. compile shared + service ───────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/crm-api apps/crm-api
RUN npm run build -w @propflow/shared && npm run build -w @propflow/crm-api

# ── 3. production deps only ───────────────────────────────────────────
FROM node:20-alpine AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/crm-api/package.json apps/crm-api/
RUN npm ci --omit=dev --workspace @propflow/shared --workspace @propflow/crm-api --no-audit --no-fund \
 && npm cache clean --force \
 && find node_modules \( -name "*.md" -o -name "*.d.ts" -o -name "*.map" \) -type f -delete

# ── 4. runtime: non-root, no toolchain, no sources ────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production PORT=4001 NODE_OPTIONS=--max-old-space-size=192
WORKDIR /repo
RUN apk add --no-cache tini
COPY --from=prod-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/package.json ./package.json
COPY --from=build --chown=node:node /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /repo/apps/crm-api/package.json ./apps/crm-api/package.json
COPY --from=build --chown=node:node /repo/apps/crm-api/dist ./apps/crm-api/dist
USER node
WORKDIR /repo/apps/crm-api
EXPOSE 4001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tini forwards SIGTERM to node (graceful shutdown ≤ 10 s) and reaps zombies.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/server.js"]
# Migrations are a separate command, never on boot:
#   docker run --rm --env-file .env <image> node dist/src/scripts/migrate.js up
