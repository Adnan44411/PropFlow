# PropFlow — multi-tenant real-estate CRM (backend)

Two Node.js services and a shared schema package:

| Package | What it does | Stack |
|---|---|---|
| `apps/auth-server` | Identity: tenants, users, invites, **RS256 access tokens + JWKS**, rotating refresh tokens with reuse detection, login lockout, key rotation | TypeScript (strict), Express, Sequelize/MySQL `auth_db`, Redis |
| `apps/crm-api` | Properties, bulk actions, streaming Excel export, site visits, notes, **Socket.IO chat**, master data, dashboard, cron jobs | TypeScript, Express, Sequelize/MySQL `crm_db`, Redis, Socket.IO + Redis adapter, ExcelJS, node-cron |
| `packages/shared` | One Zod schema per entity, roles, error codes, socket event names. Used by both services (and by the web app's react-hook-form) | Zod |

> **Scope of this delivery:** the backend (both services, shared package, Docker, CI, tests, OpenAPI docs). The React app (`apps/web`) is not part of this delivery. See [DECISIONS.md](DECISIONS.md) §1 and §5 for exactly what that leaves open.

## Live URLs

| | URL |
|---|---|
| auth-server | `https://<your-auth>.up.railway.app` → `/health`, `/.well-known/jwks.json`, `/docs` |
| crm-api | `https://<your-crm>.up.railway.app` → `/health`, `/docs` |
| web | `https://propflow-<you>.web.app` |

Fill these in after deploying (see [Deploy](#deploy-railway)). Railway's free tier sleeps, so the first request after idle can take a few seconds.

## Seeded logins

Every account uses the password **`PropFlow@123`**, or whatever `SEED_PASSWORD` was set to.

| Role | Tenant A: Skyline Realty (10,000 listings) | Tenant B: Harbour Homes (300 listings) |
|---|---|---|
| SUPER_ADMIN | `super@propflow.dev` (platform, no tenant) | |
| ADMIN | `admin@skyline.dev` | `admin@harbour.dev` |
| MANAGER | `manager@skyline.dev` | `manager@harbour.dev` |
| AGENT | `riya@skyline.dev`, `kabir@skyline.dev` | `arjun@harbour.dev`, `sara@harbour.dev` |

## Setup (5 commands)

Prerequisites: Node 20+ and Docker.

```bash
npm ci
cp .env.example .env && npm run -s keys:generate >> .env
docker compose up -d --build
docker compose run --rm seed-auth && docker compose run --rm seed-crm
open http://localhost:4000/docs http://localhost:8080/docs
```

This brings up MySQL (two databases, two users), Redis, auth-server on `:4000`, crm-api behind nginx on `:8080`, and one-shot migration jobs. To run two crm-api instances:

```bash
docker compose up -d --scale crm-api=2 && docker compose restart nginx
```

### Without Docker (MySQL and Redis already running)

```bash
npm ci && npm run -s keys:generate                    # prints JWT_PRIVATE_KEY + KEY_ENCRYPTION_KEY
# create apps/auth-server/.env and apps/crm-api/.env from .env.example (DATABASE_URL, REDIS_URL, the two keys for auth-server)
npm run migrate && npm run seed
npm run dev:auth   # :4000
npm run dev:crm    # :4001
```

## API documentation (Swagger / OpenAPI 3.0.3)

| File | Served at |
|---|---|
| [`apps/auth-server/swagger.json`](apps/auth-server/swagger.json) (25 operations) | auth-server `/docs` (Swagger UI) and `/swagger.json` |
| [`apps/crm-api/swagger.json`](apps/crm-api/swagger.json) (34 operations + Socket.IO contract in `x-socket-io`) | crm-api `/docs` and `/swagger.json` |
| [`swagger.json`](swagger.json) (both services together, per-path `servers`) | import into Postman or Insomnia |

The specs are generated from [`scripts/build-swagger.mjs`](scripts/build-swagger.mjs) (`npm run swagger:build`), so the error shape, security schemes and pagination are defined once. Each spec documents:

- request and response schemas;
- examples for every status code;
- the roles allowed per operation (`x-roles`);
- the Socket.IO events.

CI regenerates the specs, fails if they drift from the committed files, and lints them with Redocly.

Quick try:

```bash
TOKEN=$(curl -s localhost:4000/auth/login -H 'content-type: application/json' \
  -d '{"email":"manager@skyline.dev","password":"PropFlow@123"}' | jq -r .accessToken)
curl -s "localhost:8080/properties?status=2,3&listingType=SALE&sortBy=priceInr&pageSize=5" -H "authorization: Bearer $TOKEN" | jq '.total'
curl -s -o listings.xlsx "localhost:8080/properties/export?q=Powai" -H "authorization: Bearer $TOKEN"
```

## Architecture

```
            login / refresh / logout (httpOnly cookie pf_rt)           REST + Socket.IO (Bearer access token)
 web ───────────────────────────────────────────▶ auth-server        web ─────────────────────────▶ nginx ─▶ crm-api #1, #2
                                                   │  private keys         GET /.well-known/jwks.json      │
                                                   │  (only here)   ◀──────────── cached in Redis `jwks`, refetch on unknown kid
                                                   ▼                                                      ▼
                                            MySQL auth_db                                          MySQL crm_db
                                                   └────────────── Redis (refresh tokens, rate limits, caches, cron locks,
                                                                   socket.io adapter, propflow:events pub/sub) ──────┘
```

- **Tokens.** Access tokens are RS256 JWTs: 60 s, `kid` in the header, claims `sub tid role name jti iat exp`. Refresh tokens are opaque 256-bit values stored as `rt:{sha256}` and grouped by `rtfam:{familyId}`. They rotate on every use, and a reuse deletes the whole family.
- **Key rotation.** `POST /admin/rotate-keys` creates a new pair. Old keys stay in JWKS for their grace period, and crm-api picks up the new `kid` on first sight without a restart.
- **Request pipeline in crm-api.** requestId + child logger → `authenticate` (JWKS) → `tenantScope` (`req.tenantId = token.tid`) → `authorize({ roles })` → `validate(sharedZodSchema)` → controller → service → one error handler.
- **Scoping.** Every property query goes through `propertyScope(actor)`: `tenant_id` always, plus `assignee_id = self` for agents. Anything outside the scope returns **404**.
- **Separate databases.** The services share Redis but never a MySQL database. crm-api keeps a read-only mirror of tenants and users (for names and assignees). auth-server feeds it over Redis pub/sub, with a lazy fallback from token claims. crm-api forwards `/users` and `/invites` to auth-server.

Repository layout:

```
apps/auth-server/  src/{routes,services,keys,middleware,models,lib,scripts}  migrations/  seeders/  tests/  Dockerfile  swagger.json
apps/crm-api/      src/{routes,controllers,services,models,middleware,sockets,jobs,lib,scripts}  migrations/  seeders/  tests/  Dockerfile  swagger.json
packages/shared/   src/{auth,property,siteVisit,masterData,roles,errors,events,seed}.ts
docker-compose.yml  nginx/nginx.conf  docker/mysql/init.sh  .github/workflows/ci.yml  scripts/build-swagger.mjs
```

## Tests

`npm test` runs Jest and Supertest against **real MySQL and Redis**; there is no mocked database. It covers 46 tests:

- **auth-server (18):**
  - login success and failure;
  - lockout after 5 failures;
  - refresh rotation;
  - reuse revokes the family;
  - logout makes a stolen refresh token useless;
  - JWKS contains both keys after rotation, and the old and new tokens both verify;
  - HS256 forgery rejected;
  - single-use invites;
  - last-ADMIN guard.
- **crm-api (28):**
  - H1 over REST, socket join and export;
  - H2 and the other RBAC 403s;
  - H5 (unknown `kid` → JWKS refetch);
  - H6 (stale version → 409 with the current copy);
  - H7 (two parallel POSTs → one 201 and one 409);
  - owner phone masked for a non-assigned agent;
  - bulk action rolls back when one id is bad;
  - H10 (cache invalidation);
  - H8 (idempotent chat over the socket and REST);
  - a reassigned agent is evicted from the chat room;
  - H12 (10:00 IST stored as 04:30 UTC);
  - the reminder fires exactly once, and the cron lock;
  - the stale-listing job.

```bash
docker compose up -d mysql redis
TEST_AUTH_DATABASE_URL=mysql://root:<root-pw>@127.0.0.1:3306/auth_test \
TEST_CRM_DATABASE_URL=mysql://root:<root-pw>@127.0.0.1:3306/crm_test npm test
```

## Docker images

Both images use multi-stage builds on `node:20-alpine`. The runtime stage has only production dependencies, runs as the non-root `node` user, uses `tini` as PID 1, and has a `HEALTHCHECK` on `/health`. The services shut down gracefully on SIGTERM within 10 s. Migrations run as a separate command (`node dist/src/scripts/migrate.js up`, which is Railway's `preDeployCommand`), never at boot.

| Image | Size |
|---|---|
| `propflow/auth-server` | ≈ 175 MB (node:20-alpine ≈ 135 MB + 38 MB prod `node_modules` + 0.5 MB `dist`) |
| `propflow/crm-api` | ≈ 190 MB (node:20-alpine ≈ 135 MB + 53 MB prod `node_modules` + 0.7 MB `dist`) |

These sizes are estimates. They were computed from the exact `npm ci --omit=dev` set the Dockerfile installs, because no Docker daemon was available where this was built. CI's `docker` job builds both images and fails if either is ≥ 250 MB or not running as `node`. Replace these figures with `docker image ls propflow/*` output after your first build.

## Deploy (Railway)

1. Create a Railway project with the **MySQL** and **Redis** plugins. Create two databases, `auth_db` and `crm_db`, with a separate user for each (`docker/mysql/init.sh` shows the SQL).
2. Add two services from this repo:
   - **auth-server:** config file `apps/auth-server/railway.json`.
   - **crm-api:** config file `apps/crm-api/railway.json`.

   Each builds its Dockerfile, runs migrations as a pre-deploy step, and health-checks `/health`.
3. Set the variables from `.env.example` on each service:
   - `JWT_PRIVATE_KEY` and `KEY_ENCRYPTION_KEY` on auth-server only;
   - `AUTH_SERVER_URL` on crm-api;
   - `WEB_ORIGIN` and `WEB_URL` = the Firebase URL;
   - `COOKIE_SECURE=true` and `COOKIE_SAMESITE=none`.
4. Seed once: `railway run -s auth-server node dist/seeders/seed.js`, then the same for `crm-api`.

**Cookie choice.** The web app (`*.web.app`) and the API (`*.up.railway.app`) are different *sites*, so the refresh cookie must be `SameSite=None; Secure`. That opens CSRF, so `/auth/refresh` and `/auth/logout` also reject any browser `Origin` that is not in `WEB_ORIGIN`. CORS is locked to `WEB_ORIGIN` with credentials. The cookie is scoped to `Path=/auth`, so it is never sent to other endpoints.

## Known gaps

The full, honest list is in [DECISIONS.md](DECISIONS.md) §5. In short:

- The React web app is not included.
- Nothing has been deployed yet: no live URLs, no video, no memory screenshot.
- Docker and compose files are written but were not run in the build environment.
- A refresh race between two browser tabs logs the user out, because it is treated as reuse.
