# PropFlow — Multi-Tenant Real-Estate CRM

PropFlow is a production-ready, multi-tenant real-estate CRM built with two Node.js backend services, a shared Zod schema package, and a React web application.

The system supports tenant isolation, role-based access control, property management, bulk operations, Excel exports, site visits, notes, real-time chat, dashboard analytics, background jobs, authentication, rotating refresh tokens, JWKS-based JWT verification, and Redis-backed distributed coordination.

---

## Live Application

| Component | Live URL |
|---|---|
| Web application | [https://propflow-web-tco5.onrender.com](https://propflow-web-tco5.onrender.com?utm_source=chatgpt.com) |
| Auth server | [https://propflow-auth-server.onrender.com](https://propflow-auth-server.onrender.com?utm_source=chatgpt.com) |
| CRM API | [https://propflow-crm-api.onrender.com](https://propflow-crm-api.onrender.com?utm_source=chatgpt.com) |

### Health endpoints

- Auth server: `/health`
- CRM API: `/health`
- Auth JWKS: `/.well-known/jwks.json`
- Auth Swagger UI: `/docs`
- CRM Swagger UI: `/docs`

The production deployment uses:

- **Render** for the web application and both Node.js services
- **Aiven MySQL** for the separate `auth_db` and `crm_db` databases
- **Aiven Valkey** for Redis-compatible caching, token storage, pub/sub, cron locks, and Socket.IO coordination

---

## Repository Structure

```text
propflow/
├── apps/
│   ├── auth-server/
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   ├── middleware/
│   │   │   ├── models/
│   │   │   ├── keys/
│   │   │   ├── lib/
│   │   │   └── scripts/
│   │   ├── migrations/
│   │   ├── seeders/
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   └── swagger.json
│   │
│   ├── crm-api/
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── controllers/
│   │   │   ├── services/
│   │   │   ├── middleware/
│   │   │   ├── models/
│   │   │   ├── sockets/
│   │   │   ├── jobs/
│   │   │   └── lib/
│   │   ├── migrations/
│   │   ├── seeders/
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   └── swagger.json
│   │
│   └── web/
│       └── React frontend
│
├── packages/
│   └── shared/
│       └── src/
│
├── docker-compose.yml
├── DECISIONS.md
├── RUNBOOK.md
├── .github/workflows/ci.yml
├── scripts/build-swagger.mjs
└── package.json
```

---

# Architecture

```text
                         ┌──────────────────────────┐
                         │      React Web App        │
                         │      Render Static        │
                         └────────────┬─────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │                                   │
             Authentication                        REST / Socket.IO
                    │                                   │
                    ▼                                   ▼
        ┌──────────────────────┐             ┌──────────────────────┐
        │    auth-server       │             │      crm-api         │
        │      Render          │             │       Render         │
        │                      │             │                      │
        │ JWT / JWKS           │             │ Properties            │
        │ Login / Lockout      │             │ RBAC                  │
        │ Refresh rotation     │             │ Dashboard             │
        │ Invites              │             │ Notes                 │
        │ Key rotation         │             │ Site visits           │
        └──────────┬───────────┘             │ Excel export          │
                   │                         │ Socket.IO chat        │
                   │                         │ Cron jobs             │
                   ▼                         └──────────┬───────────┘
        ┌──────────────────────┐                         │
        │ Aiven MySQL          │                         │
        │ auth_db              │                         │
        └──────────────────────┘                         │
                                                         │
        ┌──────────────────────┐                         │
        │ Aiven MySQL          │◄────────────────────────┘
        │ crm_db               │
        └──────────────────────┘

                   ┌────────────────────────────┐
                   │      Aiven Valkey          │
                   │                            │
                   │ Refresh tokens             │
                   │ Rate limiting              │
                   │ Caches                     │
                   │ JWKS cache                 │
                   │ Pub/Sub                    │
                   │ Cron locks                 │
                   │ Socket.IO adapter          │
                   └────────────────────────────┘
```

The two services share Redis/Valkey but **never share a MySQL database**.

`auth-server` owns identity data.

`crm-api` maintains a read-only mirror of the tenant/user information it needs for CRM operations.

---

# Services

## `apps/auth-server`

Responsible for identity and authentication:

- Multi-tenant users
- Tenant management
- Invitations
- Login
- Login failure tracking
- Account lockout
- RS256 access tokens
- JWKS publishing
- Rotating refresh tokens
- Refresh-token reuse detection
- Logout/revocation
- JWT key rotation
- Security events
- Redis-backed token/session state

Stack:

- TypeScript
- Express
- Sequelize
- MySQL
- Redis/Valkey
- JWT/JWKS
- Zod

---

## `apps/crm-api`

Responsible for CRM functionality:

- Properties
- Property search/filtering
- Property detail
- Bulk property operations
- Excel streaming export
- Site visits
- Property notes
- Property activity
- Master data
- Dashboard
- User/tenant-aware CRM operations
- Socket.IO chat
- Redis adapter
- Cron jobs
- Stale-listing processing
- Visit reminders

Stack:

- TypeScript
- Express
- Sequelize
- MySQL
- Redis/Valkey
- Socket.IO
- ExcelJS
- node-cron
- Zod

---

## `packages/shared`

The shared package prevents the frontend and backend services from defining incompatible contracts.

It contains shared:

- Zod schemas
- Roles
- Error codes
- Socket event names
- Property schemas
- Site visit schemas
- Master-data schemas
- Authentication-related types

Both backend services and the React application consume the shared contracts where applicable.

---

# Authentication

PropFlow uses short-lived RS256 access tokens and rotating opaque refresh tokens.

### Access tokens

Access tokens are:

- RS256 signed JWTs
- 60-second lifetime
- Identified by a `kid`
- Published through JWKS
- Issued with claims including:

```text
sub
tid
role
name
jti
iat
exp
```

The CRM API validates the token signature using the auth server's JWKS endpoint.

JWKS keys are cached and automatically refetched when an unknown `kid` is encountered.

### Refresh tokens

Refresh tokens are:

- Opaque
- 256-bit random values
- Stored as SHA-256 hashes in Redis
- Grouped into refresh-token families
- Rotated on every successful use

If an already-used refresh token is presented again, the complete refresh-token family is revoked.

### Cookie security

The refresh token is stored in an HTTP-only cookie.

Production configuration uses:

```text
COOKIE_SECURE=true
COOKIE_SAMESITE=none
COOKIE_PATH=/auth
```

Because the frontend and API are hosted on different origins, CORS is restricted to the configured frontend origin and credentialed requests are used for authentication.

---

# Multi-Tenancy and Authorization

Every CRM request is scoped to the authenticated tenant.

The request pipeline is:

```text
requestId
   ↓
authentication
   ↓
tenant scope
   ↓
role authorization
   ↓
Zod validation
   ↓
controller
   ↓
service
   ↓
error handler
```

The authenticated token provides the tenant identity.

For property access:

```text
tenant_id = authenticated tenant
```

Agents additionally receive:

```text
assignee_id = current user
```

This prevents an agent from accessing another tenant's data or another agent's restricted properties.

Resources outside the authenticated user's scope return `404` where appropriate.

---

# Roles

Supported roles:

```text
SUPER_ADMIN
ADMIN
MANAGER
AGENT
```

Role permissions are enforced by the CRM API rather than relying on frontend visibility.

---

# Seeded Users

The production database currently contains two tenants and nine seeded users.

### Tenant A — Skyline Realty

```text
10,000 listings
```

| Role | Account |
|---|---|
| ADMIN | `admin@skyline.dev` |
| MANAGER | `manager@skyline.dev` |
| AGENT | `riya@skyline.dev` |
| AGENT | `kabir@skyline.dev` |

### Tenant B — Harbour Homes

```text
300 listings
```

| Role | Account |
|---|---|
| ADMIN | `admin@harbour.dev` |
| MANAGER | `manager@harbour.dev` |
| AGENT | `arjun@harbour.dev` |
| AGENT | `sara@harbour.dev` |

### Platform account

```text
SUPER_ADMIN
super@propflow.dev
```

All seeded accounts use the configured `SEED_PASSWORD`.

**Do not commit `SEED_PASSWORD` or any production credentials to Git.**

---

# Database Design

PropFlow uses two separate MySQL databases.

## `auth_db`

Contains authentication-owned data including:

- tenants
- users
- invites
- signing keys
- security events
- schema migration state

## `crm_db`

Contains CRM-owned data including:

- tenants/user mirror
- property statuses
- property types
- localities
- amenities
- properties
- property amenities
- property notes
- property activity
- site visits
- chat messages
- schema migration state

The services do not directly share MySQL tables.

---

# Redis / Valkey Usage

Redis-compatible storage is used for:

- Refresh tokens
- Refresh-token families
- Rate limits
- Dashboard caching
- JWKS caching
- Pub/Sub
- Cross-service identity events
- Cron locks
- Socket.IO Redis adapter
- Distributed coordination

This allows multiple CRM API instances to share state.

---

# Real-Time Chat

CRM chat uses Socket.IO.

The system supports:

- Tenant-aware chat access
- Property-specific rooms
- Idempotent chat operations
- REST/socket consistency
- Redis adapter for multi-instance operation
- Reassignment-based room eviction

The Socket.IO contract is also documented in the CRM OpenAPI specification under `x-socket-io`.

---

# Background Jobs

The CRM API contains scheduled jobs for:

- Site-visit reminders
- Stale-listing detection
- Distributed cron locking

Cron configuration includes:

```text
CRON_ENABLED=true
CRON_TZ=Asia/Kolkata
REMINDER_LEAD_MINUTES=15
STALE_AFTER_DAYS=30
```

The reminder job is designed to fire once even when multiple CRM API instances are running.

---

# API Documentation

OpenAPI 3.0.3 specifications are committed for both services.

### Auth API

```text
/docs
/swagger.json
```

The auth specification documents approximately 25 operations.

### CRM API

```text
/docs
/swagger.json
```

The CRM specification documents approximately 34 REST operations plus the Socket.IO contract.

The specifications include:

- Request schemas
- Response schemas
- Authentication requirements
- Error responses
- Examples
- Pagination
- Role requirements
- Socket.IO events

Swagger files are generated by:

```bash
npm run swagger:build
```

---

# Local Development

## Prerequisites

- Node.js 20+
- npm
- Docker
- Docker Compose

## Install dependencies

```bash
npm ci
```

## Configure environment

```bash
cp .env.example .env
```

Generate development JWT keys:

```bash
npm run -s keys:generate
```

Configure the generated values in the appropriate environment files.

---

# Docker Development

Start MySQL and Redis/Valkey:

```bash
docker compose up -d --build
```

Run the authentication seed:

```bash
docker compose run --rm seed-auth
```

Run the CRM seed:

```bash
docker compose run --rm seed-crm
```

The standard local setup exposes:

```text
auth-server → :4000
crm-api     → :8080 through nginx
```

To run multiple CRM API instances:

```bash
docker compose up -d --scale crm-api=2
docker compose restart nginx
```

---

# Running Without Docker

When MySQL and Redis are already available:

```bash
npm ci
npm run -s keys:generate
```

Configure:

```text
DATABASE_URL
REDIS_URL
JWT_PRIVATE_KEY
KEY_ENCRYPTION_KEY
```

Then run migrations and seeds:

```bash
npm run migrate
npm run seed
```

Start the services:

```bash
npm run dev:auth
npm run dev:crm
```

The development services run on:

```text
auth-server → :4000
crm-api     → :4001
```

---

# Example API Usage

Login:

```bash
TOKEN=$(curl -s http://localhost:4000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"manager@skyline.dev","password":"YOUR_SEED_PASSWORD"}' \
  | jq -r .accessToken)
```

Query properties:

```bash
curl -s \
  "http://localhost:8080/properties?status=2,3&listingType=SALE&sortBy=priceInr&pageSize=5" \
  -H "authorization: Bearer $TOKEN" \
  | jq '.total'
```

Stream an Excel export:

```bash
curl -s \
  -o listings.xlsx \
  "http://localhost:8080/properties/export?q=Powai" \
  -H "authorization: Bearer $TOKEN"
```

---

# Testing

The test suite uses real MySQL and Redis rather than mocked database implementations.

Run:

```bash
npm test
```

The project contains **46 tests**:

### Auth server — 18 tests

Coverage includes:

- Successful login
- Failed login
- Login lockout after repeated failures
- Refresh-token rotation
- Refresh-token reuse detection
- Refresh-family revocation
- Logout/revocation
- JWKS key rotation
- Old/new token verification during key grace period
- HS256 forgery rejection
- Single-use invitations
- Last-admin protection

### CRM API — 28 tests

Coverage includes:

- REST property flows
- Socket.IO flows
- Excel export
- RBAC restrictions
- Unknown `kid` JWKS refetch
- Stale-version `409` handling
- Concurrent update conflict handling
- Agent owner-phone masking
- Bulk-action rollback
- Cache invalidation
- Idempotent chat
- Chat-room eviction after reassignment
- IST → UTC visit-time conversion
- Reminder execution
- Distributed cron locking
- Stale-listing processing

---

# Docker Images

Both backend services use multi-stage Docker builds based on:

```text
node:20-alpine
```

The runtime images:

- Install production dependencies only
- Run as the non-root `node` user
- Use `tini` as PID 1
- Include `/health` health checks
- Handle graceful SIGTERM shutdown
- Run migrations separately from application boot

Migrations are intentionally **not executed during application startup**.

They are executed as a separate deployment/pre-deployment operation.

---

# CI

GitHub Actions runs the project's automated checks.

The CI pipeline validates:

- TypeScript
- Tests
- Swagger generation
- Swagger drift
- OpenAPI linting
- Docker builds
- Docker runtime user configuration
- Docker image size constraints

The repository contains:

```text
.github/workflows/ci.yml
```

---

# Production Deployment

The current production deployment uses Render and Aiven.

## Render

Three Render services are deployed:

```text
propflow-web
propflow-auth-server
propflow-crm-api
```

The backend services use their respective Dockerfiles:

```text
apps/auth-server/Dockerfile
apps/crm-api/Dockerfile
```

The React application is deployed as a Render static site.

## Aiven

Production infrastructure uses:

```text
Aiven MySQL
  ├── auth_db
  └── crm_db

Aiven Valkey
```

The production databases have been migrated and seeded.

---

# Production Verification

The deployed system has been verified for the following critical flow:

```text
Browser
  ↓
React application
  ↓
Production authentication
  ↓
Production MySQL + Valkey
  ↓
Production CRM API
  ↓
Dashboard / Properties
```

Verified:

- Auth health endpoint
- CRM health endpoint
- MySQL connectivity
- Redis/Valkey connectivity
- JWKS publication
- Production seeded users
- Production login
- Dashboard data loading
- Property data loading
- Client-side route refresh
- SPA fallback routing

---

# Security

Production secrets must never be committed to Git.

The following values must remain environment variables:

```text
DATABASE_URL
REDIS_URL
JWT_PRIVATE_KEY
KEY_ENCRYPTION_KEY
SEED_PASSWORD
```

The auth server is the only service that requires the JWT private key.

The CRM API only needs the public JWKS endpoint for token verification.

The production refresh cookie uses:

```text
HttpOnly
Secure
SameSite=None
Path=/auth
```

CORS is restricted to the configured production web origin.

---

# Known Limitations

The following limitations are intentionally documented rather than hidden:

1. A simultaneous refresh request from two browser tabs can be interpreted as refresh-token reuse. The refresh-token family is revoked as a security response.
2. Free hosting infrastructure may cold-start after inactivity, so the first request can take longer than subsequent requests.
3. Production infrastructure depends on the availability and configuration limits of Render and Aiven free/entry-level services.
4. Production secrets should be rotated whenever they have been exposed outside the intended secret-management environment.

---

# Assignment Scope

The project now includes:

- `apps/auth-server`
- `apps/crm-api`
- `packages/shared`
- `apps/web`
- Docker configuration
- CI
- Tests
- OpenAPI documentation
- Database migrations
- Seeders
- Production deployment configuration

The React application is included in the current deployed project and is available through the production web URL.

---

# Final Project Status

```text
Backend                    ✅
Authentication             ✅
Multi-tenancy              ✅
RBAC                       ✅
JWT / JWKS                 ✅
Refresh-token rotation     ✅
Key rotation               ✅
Redis / Valkey             ✅
CRM API                    ✅
Properties                 ✅
Bulk operations            ✅
Excel export               ✅
Site visits                ✅
Notes                      ✅
Socket.IO chat             ✅
Dashboard                  ✅
Cron jobs                  ✅
Shared schemas             ✅
Docker                     ✅
CI                         ✅
OpenAPI                    ✅
Tests                      ✅
React frontend             ✅
Production deployment      ✅
Production login           ✅
SPA routing                ✅
GitHub source              ✅
```

## Repository

The source code is hosted in the PropFlow Git repository.

Production application:

[PropFlow Web Application](https://propflow-web-tco5.onrender.com?utm_source=chatgpt.com)

---

## License

This project was developed as part of the PropFlow technical assignment.
