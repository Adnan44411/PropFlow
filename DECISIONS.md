# DECISIONS

## 1. Hard checks status (H1–H12)

"Test" means an automated Jest + Supertest test against real MySQL 9.3 and Redis 7 (`npm test`). "Live" means a check run by hand against locally running services. Nothing here was run against a deployed Railway stack yet (see §5).

| # | Check | Status | How |
|---|---|---|---|
| H1 | Tenant isolation | **Done** | `tenantScope` takes `req.tenantId` only from the token's `tid`. `propertyScope()` adds `tenant_id` to every property query, bulk lock, export batch and socket `property:join`. Tests cover REST GET/PATCH/DELETE/messages → 404, list/export with tenant-A filters → `X-Total-Count: 0` and a header-only xlsx, socket join → `NOT_FOUND`, and a tenant-B id inside a tenant-A bulk request → 422 with nothing written. |
| H2 | Agent ownership | **Done** | `propertyScope()` adds `assignee_id = self` for AGENT, so a non-assigned id is 404, never 403. The list only returns the agent's own rows. Export, bulk, dashboard, admin routes and the `assignee` filter return 403 FORBIDDEN_ROLE. All tested. |
| H3 | Refresh race | **Partial** | Backend: refresh is an atomic Lua consume-and-rotate; only one of N concurrent calls with the same token can succeed (tested). The web `baseQueryWithReauth` (shared promise) is part of `apps/web`, which is not in this delivery. |
| H4 | Refresh reuse | **Done** | Replaying a used token deletes the whole `rtfam:{familyId}`, including the legitimate newest token. It returns 401 `REFRESH_REUSED` and writes a CRITICAL `REFRESH_REUSE_DETECTED` security event. Tested, including that the real session's token then fails. |
| H5 | Key rotation | **Done** | `POST /admin/rotate-keys` makes a new signer and retires the old key, which stays in JWKS for `RETIRED_KEY_GRACE_SECONDS`. Auth test: JWKS holds both kids, and old and new tokens both pass. crm-api test: a token with a never-seen `kid` triggers a JWKS refetch and is accepted without a restart, and old-key tokens still pass. Also run live against the running services. |
| H6 | Optimistic locking | **Done (API)** | PATCH requires `version`. The row is locked `FOR UPDATE` and the version compared; `UPDATE … WHERE version = ?` repeats the check. A stale version gets 409 `VERSION_CONFLICT` with `details.current` = the full server copy. The conflict dialog itself is web. Tested. |
| H7 | Duplicate listing | **Done** | Unique index `(tenant_id, building_name, unit_no, alive)`. `alive` is a generated column (`1` for live rows, `NULL` when soft-deleted), so a deleted unit can be re-listed. A `UniqueConstraintError` maps to 409 `DUPLICATE_LISTING`. Tested with two parallel POSTs: exactly one 201 and one 409, and one row in the DB. |
| H8 | Chat idempotency | **Done** | Unique `(property_id, client_msg_id)`, and the message is persisted before broadcast. A retry acks the original row with `duplicate: true` and is not re-broadcast. Tested over Socket.IO (the other client receives exactly one `chat:new`) and over the REST fallback (201, then 200). |
| H9 | Multi-instance | **Done (live), compose not run** | Redis adapter plus the cron lock `SET lock:cron:{job} NX EX 55` plus a conditional `UPDATE … WHERE reminded_at IS NULL`. Live run with two crm-api processes (ports 4001 and 4002) sharing Redis: a user on #1 sent, the user on #2 received in **9 ms**. For a visit 10 min out, the log shows exactly one `cron job finished reminded:1` (instance crm-2); the agent's socket, connected to crm-1, got **1** `visit:reminder`. `docker compose --scale crm-api=2` behind nginx (`ip_hash`) is written but was not run (no Docker daemon in the build environment). |
| H10 | Cache invalidation | **Done** | Master data is served read-through from `md:{tenantId}:{kind}`. Every write deletes all four `md:{tenantId}:*` keys and emits `masterdata:updated`. List and detail resolve names from that cache at read time, never from denormalised copies. Tested: rename a locality, and the list shows the new name immediately. |
| H11 | Export at scale | **Done (local)** | ExcelJS `WorkbookWriter` streams into `res`, reading keyset batches of 1,000 (`id > lastId`) and waiting on `drain`. Compiled build, 10,000 rows: valid xlsx (10,001 rows incl. header, 1.5 MB) in **0.58–0.68 s**. Under `--max-old-space-size=80`, 8 back-to-back exports held flat at **115–120 MB RSS** (idle 67 MB), with no OOM. Railway memory screenshot still to take. |
| H12 | Time zone | **Done (API)** | Stored as DATETIME in UTC (Sequelize `timezone: '+00:00'`, MySQL `--default-time-zone=+00:00`) and returned as ISO `Z`. Test: `visitAt: 2030-10-01T10:00:00+05:30` → stored `04:30`, returned `04:30:00.000Z`. The reminder cron compares in UTC. The nightly stale job is scheduled at 02:00 with an explicit `Asia/Kolkata` time zone. Rendering in the browser's zone is web. |

## 2. Assumptions I made

- **One MySQL server is fine, one database is not.** `auth_db` and `crm_db` have separate MySQL users that cannot read each other's database.
- **Users are owned by auth-server.** crm-api needs names for the assignee column, leaderboard and chat. It keeps a read-only mirror (`tenants`, `users` in crm_db), fed three ways:
  - Redis pub/sub `propflow:events` (`tenant.created`, `user.upserted`);
  - a lazy upsert from token claims (`name` is an extra claim);
  - the seed.

  `/users` and `/invites` on crm-api are forwarded to auth-server with the caller's bearer token, so auth-server stays the single source of truth for identity.
- **Invite links are RS256 JWTs** (`typ=invite`, `aud=propflow:invite`, `jti` = invite id, 24 h). Single use is enforced in the DB (row lock + `accepted_at`). No email is sent; the link is returned and logged.
- **SUPER_ADMIN creates tenants via an invite** for the first admin, instead of setting a password for them.
- **Rotated private keys must survive restarts and be shared by every auth-server instance.** They are stored AES-256-GCM encrypted in `signing_keys` with `KEY_ENCRYPTION_KEY` (env only). The bootstrap key lives only in `JWT_PRIVATE_KEY`.
- **Retired keys stay published for 24 h + 5 min,** not just 60 s, because invite links signed with them live 24 h. Publishing a public key longer is harmless.
- **"Closed value"** = `price_inr` of listings whose status stage is `WON` with `closed_at` in the range. For RENT listings this is the monthly rent (kept simple; it could be weighted ×12).
- **Status stages.** Statuses carry `stage ∈ {OPEN, WON, LOST}`, so renaming "Closed" never breaks terminal logic or the dashboard. WON and LOST are terminal: leaving them returns 422 `TERMINAL_STATUS`.
- **Amenity filter semantics.** `amenity[]` means the listing must have **all** of the selected amenities.
- **Role changes and deactivation** take effect at the next refresh (≤ 60 s), because refresh tokens are revoked immediately. Access tokens are not blocklisted.

## 3. Database indexes and EXPLAIN output for GET /properties

Indexes (`apps/crm-api/migrations/20261001000000-init.ts`):

| Index | Serves |
|---|---|
| `ix_prop_tenant_created (tenant_id, deleted_at, created_at)` | Default sort (newest first), date range, `COUNT(*)` for the grid |
| `ix_prop_tenant_status (tenant_id, status_id, deleted_at, created_at)` | Status filter, dashboard funnel |
| `ix_prop_tenant_assignee (tenant_id, assignee_id, deleted_at, created_at)` | AGENT scope (every agent query) and the agent filter; covering for the count |
| `ix_prop_tenant_listing_price (tenant_id, listing_type, price_inr)` | Sale/Rent + price range + sort by price |
| `ix_prop_tenant_locality`, `ix_prop_tenant_type_bhk`, `ix_prop_tenant_area` | Remaining filters |
| `ix_prop_tenant_closed (tenant_id, closed_at)` | Dashboard leaderboard |
| `uq_properties_tenant_building_unit (tenant_id, building_name, unit_no, alive)` | H7 plus the inline duplicate check |
| `ix_prop_stale (is_stale, last_activity_at)` | Nightly job |
| `ix_pa_amenity (amenity_id, property_id)` | Amenity filter subquery |

Output of `npm run explain -w @propflow/crm-api` on the seeded data (10,300 rows, MySQL 9.3, after `ANALYZE TABLE`):

```
### Default list (tenant, newest first, page 1)  (2 ms)
SELECT * FROM properties WHERE tenant_id = 1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 25
 type=range key=ix_prop_tenant_created key_len=10 rows=5101 filtered=100  Extra: Using index condition; Backward index scan

### Count for default list  (2 ms)
SELECT COUNT(*) FROM properties WHERE tenant_id = 1 AND deleted_at IS NULL
 type=ref   key=ix_prop_tenant_created key_len=10 rows=5101 filtered=100  Extra: Using where; Using index

### AGENT scope — count
SELECT COUNT(*) FROM properties WHERE tenant_id=1 AND assignee_id=4 AND deleted_at IS NULL
 key=ix_prop_tenant_assignee rows=5097  Extra: Using where; Using index

### Sale + price range, sort by price  (1 ms)
... listing_type='SALE' AND price_inr BETWEEN 5000000 AND 20000000 ... ORDER BY price_inr, id LIMIT 25
 type=range key=ix_prop_tenant_listing_price key_len=13 rows=3459 filtered=10  Extra: Using index condition; Using where

### Status / locality / type+BHK filters, first page  (0–1 ms)
 type=range key=ix_prop_tenant_created  Extra: Using index condition; Using where; Backward index scan
 (with LIMIT 25 and ORDER BY created_at the optimizer walks the sort index backwards and stops after 25 hits,
  cheaper than filter-then-sort because each filter matches 10–60 % of the tenant)

### Duplicate check  (0 ms)
 type=ref key=uq_properties_tenant_building_unit rows=1
```

Measured latency, same machine and data: 360 `GET /properties` requests over 12 filter/sort combinations (manager and agent; free text, amenities, name sorts, page 200). Result: **p50 14 ms, p95 32 ms, p99 36 ms** end-to-end over HTTP. The target is p95 < 300 ms.

Notes:

- Tenant A is 97 % of the table, so `tenant_id` alone is barely selective. The composite indexes matter much more on a real multi-tenant table.
- For `status_id IN (…)` counts, MySQL sometimes chooses a different index; it is still ~2 ms at this size.
- Free text (`q`) uses `LIKE %q%` on five columns inside the tenant's rows. At ≥ 100k rows per tenant I would switch to a FULLTEXT index with an ngram parser.

## 4. Trade-offs (what I chose, what I gave up)

- **Everything in TypeScript, including crm-api** (JS was allowed). Shared Zod types flow end-to-end, and `tsc --noEmit` in CI catches contract drift. The cost is a build step for crm-api.
- **Own JWKS client instead of `jwks-rsa`.** It is roughly 80 lines: Redis-shared cache (`jwks`, 10 min), in-flight dedupe, and forced refetch on an unknown `kid` throttled to one per 5 s. That matches the Redis key the spec asked for, and I can explain every line.
- **Opaque refresh tokens in Redis instead of refresh JWTs.** They can be revoked instantly and support families and reuse detection. They depend on Redis (no Redis → no refresh), which is acceptable because Redis is already critical for rate limits and sockets.
- **Reuse detection has no grace window.** Two tabs refreshing at the same instant with the same cookie look like theft, and both sessions are logged out. That is the most secure choice. A 5–10 s "same successor" grace would soften it; not done.
- **Export order is by `id`, not the grid's sort.** Keyset pagination on `id` keeps memory and DB cost flat, while arbitrary-column keyset pagination is more complex. Filters are honoured exactly.
- **The dashboard cache is invalidated on property writes,** not just left to its 60 s TTL. The keys are tracked in a Redis set, so no `SCAN` is needed.
- **`property:updated` goes to staff and assignee rooms, not the whole tenant.** Agents never learn the ids of listings they cannot see. When a listing is reassigned (single or bulk), the former agent's sockets are removed from `property:{id}` on every instance (`socketsLeave` through the Redis adapter), so they stop receiving its chat.
- **Socket auth is checked per event (`exp`),** plus `auth:renew`, instead of disconnecting at expiry. An expired socket acks `TOKEN_EXPIRED`; the client renews and retries with the same `clientMsgId`, so nothing is lost or duplicated.
- **Cron lock is not released early.** It expires after 55 s, so a second instance firing a few hundred ms late cannot re-run the same tick. The conditional `reminded_at IS NULL` update is a second safety net.
- **Owner phone masking lives in the serializers** (property, site-visit, export). A non-assigned agent never has access to a property detail anyway (404), but they can see a visit a manager scheduled for them on someone else's listing. That is where masking is exercised, and it is tested.
- **bcryptjs (pure JS) instead of native bcrypt.** There are no native builds in Alpine images. It is slower per hash, which is fine at login rates.

## 5. Known bugs and gaps

- **No web app.** `apps/web` (React 18, RTK Query, MUI, the 12 screens, `baseQueryWithReauth`) is not in this delivery. The web half of H3, the H6 dialog and the H12 display are therefore not done.
- **Not deployed.** There are no live Railway or Firebase URLs yet, no 5-minute video and no container memory screenshot. `railway.json` for both services (Dockerfile build, `preDeployCommand` migrations, `/health` healthcheck, 10 s draining) is ready.
- **Docker not executed here.** The Dockerfiles, compose file and nginx config were written but not run, because no Docker daemon was available. Image sizes in the README are computed from the production dependency tree, not measured with `docker image ls`. CI builds both images and enforces < 250 MB and a non-root user.
- **Git history.** The code has not been committed. Create the repo with feature branches and PRs (for example `feat/shared-schemas`, `feat/auth-server`, `feat/crm-properties`, `feat/realtime-cron`, `chore/docker-ci-docs`) so the ≥ 5 merged PRs requirement holds.
- **nginx resolves `crm-api` replicas at start-up.** After changing `--scale`, run `docker compose restart nginx`.
- **User mirror consistency.** If crm-api is down when auth-server publishes `user.upserted`, a rename or deactivation reaches crm-api only on that user's next request, via token claims. A deactivated user's name is still shown as the assignee (which is intended).
- **An unauthenticated request to an unknown crm-api path returns 401, not 404,** because tenant routes are mounted with authentication.
- **Stretch items not done:** device list or "log out this device" UI, password reset, CSV import, photos.

## 6. With one more week I would…

1. Build `apps/web`: the 12 screens, a `baseQueryWithReauth` with a unit test for 5 parallel 401s, a DataGrid in server mode with URL-synced filters, and the conflict dialog.
2. Deploy to Railway and Firebase with a smoke-test script (all 10 flows per role) that runs after every deploy, and attach the memory graph.
3. Add a 5 s grace window to refresh-reuse detection (return the same successor to a racing tab), and a Redis blocklist of `jti`s for immediate access-token revocation on deactivation.
4. Replace the pub/sub user mirror with a Redis Stream (consumer group + replay), so crm-api cannot miss identity events.
5. Add FULLTEXT (ngram) search and export in the grid's sort order via a cursor on `(sortKey, id)`.
6. Add OpenTelemetry traces across auth-server → crm-api → MySQL, with `requestId` as the trace attribute, plus k6 load tests in CI asserting p95 on 100k rows.
7. Harden sockets further: per-user rate limit on `chat:send`, and re-validate every joined room on `auth:renew`. (Reassignment already evicts the former agent from the room on every instance; that is tested.)
