# RUNBOOK

Real commands for the six operational tasks. Each task gives the Docker Compose variant (local), a Railway variant where one applies, and plain Linux commands for a VM or container shell.

Useful facts for all of them:

- **Logs** are JSON lines on stdout (Winston). Every line carries `service`, `level`, `timestamp`, `message` and, inside a request, `requestId`. Tokens, passwords and cookies are redacted, and phone numbers are masked (`98300•••21`).
- **Request id.** Every HTTP response has an `X-Request-Id` header. Clients may send their own; otherwise a UUID is generated.
- **Sockets and cron** get their own ids: sockets log `requestId: ws-<conn>-<rand>`, cron jobs log `requestId: cron-<job>-<rand>`.
- **Ports:** auth-server `4000`, crm-api `4001` (behind nginx on `8080` in compose).

---

## 1. Tail and grep the logs for one `requestId`

Take the id from the response header (`curl -i`, or the browser's Network tab → `x-request-id`), or from an error report.

```bash
RID=2ab09269-26d8-4932-9c73-304732ee4c81

# docker compose — all services, including both crm-api replicas and nginx
docker compose logs --no-log-prefix --since 1h auth-server crm-api nginx | grep -F "$RID" | jq -c '{timestamp, service, level, message, status, ms, path}'

# follow live while reproducing
docker compose logs -f --no-log-prefix crm-api | grep --line-buffered -F "$RID"

# Railway (CLI ≥ 3)
railway logs --service crm-api | grep -F "$RID"
railway logs --service auth-server | grep -F "$RID"

# plain Linux (systemd unit or a log file)
journalctl -u propflow-crm-api --since "1 hour ago" -o cat | grep -F "$RID" | jq .
grep -hF "$RID" /var/log/propflow/*.log | jq -s 'sort_by(.timestamp)[]'
```

To find slow requests, or all errors for one user:

```bash
docker compose logs --no-log-prefix crm-api | jq -c 'select(.message=="http" and .ms > 300)'
docker compose logs --no-log-prefix crm-api | jq -c 'select(.level=="error" and .userId==4)'
```

## 2. Find which process is listening on a port

```bash
sudo ss -ltnp 'sport = :4001'          # socket, PID and program name
sudo lsof -nP -iTCP:4001 -sTCP:LISTEN  # same, with lsof (works on macOS too)
sudo fuser -v 4001/tcp                 # just the PID(s)

# inside a container (the node image has no ss; use /proc)
docker compose exec crm-api sh -c 'cat /proc/net/tcp6 /proc/net/tcp | awk "NR>1 && \$4==\"0A\" {print \$2}"'   # 0FA1 = 4001
docker compose ps --format 'table {{.Service}}\t{{.Ports}}'                                                   # port mapping per service
```

## 3. Check memory and CPU of the Node process

```bash
# containers (live); watch this during an export — see DECISIONS.md H11
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' $(docker compose ps -q crm-api auth-server)

# host process
PID=$(pgrep -f 'crm-api/dist/src/server.js' | head -1)
ps -o pid,ppid,%cpu,%mem,rss,vsz,etime,cmd -p "$PID"
top -b -n 1 -p "$PID" | tail -2
pidstat -r -u -p "$PID" 1 5                                           # 5 one-second samples (sysstat)
grep -E 'VmRSS|VmHWM|Threads' /proc/$PID/status                      # current and peak RSS

# sample RSS every 200 ms during a 10k export (proves memory stays flat)
while sleep 0.2; do ps -o rss= -p "$PID"; done | awk '{printf "%d MB\n", $1/1024}' &
curl -s -o /dev/null -H "authorization: Bearer $TOKEN" http://localhost:8080/properties/export; kill %1

# inside the container: V8 heap vs RSS
docker compose exec crm-api node -e 'const m=process.memoryUsage();console.log(Object.fromEntries(Object.entries(m).map(([k,v])=>[k,Math.round(v/1e6)+"MB"])))'
```

Railway: Service → **Metrics** shows CPU, memory and network per deploy.

## 4. Read the env vars of the running process

This prints secrets to your terminal, so pipe it through the `sed` redaction below unless you really need the values.

```bash
# host process — the environment it was started with
PID=$(pgrep -f 'auth-server/dist/src/server.js' | head -1)
sudo cat /proc/$PID/environ | tr '\0' '\n' | sort | sed -E 's/^((JWT_PRIVATE_KEY|KEY_ENCRYPTION_KEY|DATABASE_URL|REDIS_URL)=).*/\1<redacted>/'

# container: environment of PID 1 (tini) and of the node process
docker compose exec auth-server sh -c 'tr "\0" "\n" < /proc/1/environ' | sort
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $(docker compose ps -q crm-api | head -1)

# one variable only
docker compose exec crm-api printenv AUTH_SERVER_URL

# Railway — what the service is configured with
railway variables --service crm-api
```

## 5. Restart one service

```bash
# compose: one service, or one replica of a scaled service
docker compose restart auth-server
docker restart $(docker compose ps -q crm-api | sed -n 2p)        # only the 2nd crm-api replica
docker compose up -d --no-deps --build crm-api                    # rebuild + replace crm-api only
docker compose restart nginx                                      # after changing --scale crm-api=N

# systemd
sudo systemctl restart propflow-crm-api && systemctl status propflow-crm-api --no-pager

# Railway
railway redeploy --service crm-api --yes
```

On SIGTERM the process:

1. stops accepting connections;
2. stops the cron jobs;
3. lets in-flight requests finish;
4. closes the sockets (clients reconnect to the other replica);
5. closes MySQL and Redis;
6. exits within 10 s.

Confirm with:

```bash
docker compose logs --no-log-prefix --since 2m crm-api | jq -c 'select(.message|test("shutdown"))'
```

## 6. Roll back to the previous deploy on Railway

**Dashboard:**

1. Open Service → **Deployments**.
2. On the last good deployment, click **⋮ → Rollback**.

Railway redeploys that exact image with its variables. The `preDeployCommand` migration step runs again, which is a no-op because Umzug only runs pending migrations.

**CLI:**

```bash
railway deployment list --service crm-api          # find the last good deployment id
railway redeploy --service crm-api --yes           # re-run the current deployment (e.g. after a variable fix)
```

The CLI has no one-shot "rollback to id". Use the dashboard, or roll back the code:

```bash
git revert --no-edit <bad-sha> && git push origin main   # CI green → Railway redeploys main
```

**If the bad release ran a migration,** revert the schema before rolling the code back:

```bash
railway run --service crm-api node dist/src/scripts/migrate.js down     # reverts the most recent migration only
```

**Verify after rollback:**

```bash
curl -fsS https://<crm>.up.railway.app/health | jq '.status, .checks'
curl -fsS https://<auth>.up.railway.app/.well-known/jwks.json | jq '.keys | length'
```

---

### Extra: common incidents

| Symptom | Check | Fix |
|---|---|---|
| crm-api `/health` → `jwks: down` | `curl $AUTH_SERVER_URL/.well-known/jwks.json` from the crm-api container | auth-server down, or wrong `AUTH_SERVER_URL`. crm-api keeps verifying with the cached keys (Redis `jwks`, 10 min) meanwhile. |
| Everyone suddenly gets 401 `REFRESH_REUSED` | `GET /platform/security-events?type=REFRESH_REUSE_DETECTED` | A client refreshing in parallel across tabs (see DECISIONS §4), or real token theft: check `meta.originalIp` against `ip`. |
| Login returns 429 | `redis-cli --scan --pattern 'rl:login:*'` | Wait for `Retry-After`, or `redis-cli DEL "rl:login:<ip>:<email>"` for a verified user. |
| Rotated key cannot sign after restart | auth-server log: `cannot decrypt signing key` | `KEY_ENCRYPTION_KEY` changed. Restore it; never rotate it without re-encrypting `signing_keys.private_enc`. |
| Reminders not firing | `redis-cli GET lock:cron:visit-reminders`, and crm-api logs for `cron job finished` | `CRON_ENABLED=true` on at least one replica. A stuck lock expires in 55 s. |
