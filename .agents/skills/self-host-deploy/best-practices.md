# Production Best Practices

Use this checklist after initial deploy. Items marked **required** block a safe production launch.

---

## Pre-launch checklist

```
Security
- [ ] HTTPS on APP_URL (required)
- [ ] AUTH_SECRET rotated — not setup.sh default (required)
- [ ] KEY_VAULTS_SECRET rotated (required)
- [ ] .env mode 600, not in git (required)
- [ ] Postgres/Redis not exposed to internet (required)
- [ ] AUTH_ALLOWED_EMAILS set (recommended for private teams)
- [ ] Firewall: only 80/443 public (required)

Networking
- [ ] APP_URL = exact public URL (scheme + host, no trailing slash)
- [ ] INTERNAL_APP_URL = http://localhost:3210 (required in Docker)
- [ ] S3_ENDPOINT = browser-reachable HTTPS domain (required for chat images)
- [ ] AUTH_TRUSTED_ORIGINS includes APP_URL

SPA / CDN
- [ ] /_spa/assets/* returns 200 (required)
- [ ] /_spa-auth/assets/* returns 200 (required)
- [ ] CDN passes all /_spa* paths to origin unchanged
- [ ] verify-deployment.sh passes

Operations
- [ ] Automated DB backup cron (`./scripts/panachat-backup.sh --install-cron`)
- [ ] Pre-deploy backup via `moz -u` / `moz -d` (default on)
- [ ] Image tag pinned (not bare :latest in prod)
- [ ] Disk alert configured
- [ ] Update runbook documented
```

---

## 1. Secrets & access control

### Rotate all auto-generated secrets

`setup.sh` secrets are fine for dev. **Before going public**, regenerate:

```bash
openssl rand -base64 32 # AUTH_SECRET
openssl rand -base64 32 # KEY_VAULTS_SECRET
openssl rand -base64 24 # POSTGRES_PASSWORD
openssl rand -base64 24 # RUSTFS_SECRET_KEY
```

Update `.env`, then: `docker compose up -d --force-recreate`

### Restrict who can sign up

```env
# Only these emails can log in (comma-separated)
AUTH_ALLOWED_EMAILS=you@company.com,team@company.com

# Or SSO-only (disable email/password registration)
AUTH_DISABLE_EMAIL_PASSWORD=1
AUTH_SSO_PROVIDERS=google,github
```

### Protect `.env`

```bash
chmod 600 .env
echo ".env" >> .gitignore # must never be committed
```

---

## 2. Network hardening

### Do not expose internal services

Default compose publishes Postgres (`5432`), Redis (`6379`), and RustFS admin (`9001`) to the host. **Remove these in production** — containers talk over the internal `lobe-network` bridge.

Use the production override:

```bash
docker compose -f docker-compose.yml \
  -f .claude/skills/self-host-deploy/templates/docker-compose.production.override.yml \
  up -d
```

Or manually delete `ports:` blocks from `postgresql`, `redis`, and `rustfs` (keep only what the reverse proxy needs).

### Bind app to localhost

Only the reverse proxy should reach the app:

```yaml
# production override — lobe service
ports:
  - '127.0.0.1:${LOBE_PORT:-3210}:3210'
```

### Firewall

```bash
# UFW example
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

### URL variables (critical)

| Variable               | Production value           | Why                                       |
| ---------------------- | -------------------------- | ----------------------------------------- |
| `APP_URL`              | `https://chat.example.com` | OAuth callbacks, emails, browser links    |
| `INTERNAL_APP_URL`     | `http://localhost:3210`    | In-container async jobs bypass CDN        |
| `S3_ENDPOINT`          | `https://s3.example.com`   | Browser uploads images via presigned URLs |
| `AUTH_TRUSTED_ORIGINS` | `https://chat.example.com` | Better Auth origin validation             |

Never set `S3_ENDPOINT=http://rustfs:9000` — browsers cannot resolve Docker service names.

---

## 3. Reverse proxy & CDN

### Required headers

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;   # required for HTTPS detection
proxy_http_version 1.1;
proxy_set_header Upgrade           $http_upgrade;
proxy_set_header Connection        "upgrade";
```

### SPA asset rules

| Path                       | Cache                         | Notes                                         |
| -------------------------- | ----------------------------- | --------------------------------------------- |
| `/_spa/assets/*`           | `immutable, max-age=31536000` | Hashed filenames — safe to cache forever      |
| `/_spa-auth/assets/*`      | same                          | Auth SPA chunks                               |
| `/`, `/signin`, `/agent/*` | `no-cache`                    | HTML shell — must not be stale across deploys |
| `/api/*`, `/trpc/*`        | `no-cache`                    | Dynamic API                                   |

**Never** let CDN "optimize" or rewrite `/_spa*/assets/*.js`. If icons return 200 but JS returns 500, the CDN is misconfigured.

### Cloudflare / ArvanCloud

- SSL mode: **Full (strict)** when origin has valid cert
- Disable "Rocket Loader" / JS optimization for `/_spa*`
- Page Rules: bypass cache for `/api/*`, `/trpc/*`, `/signin*`
- After deploy: purge cache for `/_spa*` **or** rely on hashed filenames (preferred)

---

## 4. Docker & releases

### Pin image versions

```yaml
# Bad — unpredictable updates
image: lobehub/lobehub

# Good — pin to digest or semver tag
image: lobehub/lobehub:1.x.x
```

Custom builds: tag with git SHA.

```bash
docker build -t aico/lobehub:$(git rev-parse --short HEAD) .
```

### Safe update procedure

```bash
# 1. Backup
docker compose exec postgresql pg_dump -U postgres lobechat > backup-pre-update.sql

# 2. Pull / rebuild
docker compose pull # official image
# OR docker build --no-cache -t aico/lobehub:NEW .

# 3. Deploy
docker compose up -d --force-recreate lobe

# 4. Verify
bash .claude/skills/self-host-deploy/scripts/verify-deployment.sh https://chat.example.com

# 5. Rollback if needed
docker compose down
# restore image tag / backup
docker compose up -d
```

### Resource limits (recommended)

```yaml
lobe:
  deploy:
    resources:
      limits:
        cpus: '4'
        memory: 8G
      reservations:
        cpus: '1'
        memory: 2G
```

---

## 5. Backups & monitoring

### Automated DB backup (cron + pre-deploy)

Aico ships `scripts/panachat-backup.sh` (also `moz -B`). It dumps Postgres via
`pg_dump` (safe while running) and optionally archives RustFS uploads. Redis is
skipped (cache/sessions).

**Recommended combo**

| Trigger                 | Command                          | Why                      |
| ----------------------- | -------------------------------- | ------------------------ |
| Before rebuild/redeploy | automatic on `moz -u` / `moz -d` | Highest wipe risk        |
| Daily 03:00             | cron via `--install-cron`        | Quiet safety net         |
| Manual                  | `moz -B`                         | Before risky experiments |

**Retention** (one nightly dump; keepers from the same files): last **14** days
daily, **Sunday** dumps up to **56** days, **1st-of-month** dumps up to **365**
days, plus the last **5** `pre-deploy` dumps.

```bash
# Manual / list
moz -B
./scripts/panachat-backup.sh --list

# Install user crontab (daily 03:00 → ~/.local/share/panachat-backups/)
./scripts/panachat-backup.sh --install-cron

# Skip auto pre-deploy backup once
MOZ_SKIP_BACKUP=1 moz -u
```

**WSL note:** user crontab only runs if the cron service is up
(`sudo service cron start`, or enable cron in your WSL distro). Prefer relying on
pre-deploy backups (`moz -u` / `moz -d`) if cron is unreliable on your machine.

Default dirs:

- Data fingerprint / leftover binds: `~/.local/share/panachat-data` (`PANACHAT_DATA_DIR`)
- Live Postgres/Redis/RustFS: named volumes `panachat_{postgres,redis,rustfs}_data`
- Backups: `~/.local/share/panachat-backups` (`PANACHAT_BACKUP_DIR`)

**Restore (SQL)** — stop app, restore into empty/known-good cluster, restart:

```bash
moz -k
# optional: wipe cluster only if intentionally replacing
# rm volume + MOZ_ALLOW_EMPTY_DB=1 moz   # init empty, then:
#   moz -k && docker volume rm panachat_postgres_data && MOZ_ALLOW_EMPTY_DB=1 moz

gunzip -c ~/.local/share/panachat-backups/panachat-YYYYMMDD-HHMMSS-*.sql.gz \
  | docker exec -i lobe-postgres psql -U postgres -d lobechat
moz -r
```

Upstream-style one-liner (standalone `setup.sh` folder, not Aico `moz`):

```bash
# /etc/cron.daily/lobehub-backup
#!/bin/bash
BACKUP_DIR=/var/backups/lobehub
mkdir -p "$BACKUP_DIR"
docker compose -f /path/to/lobehub/docker-compose.yml \
  exec -T postgresql pg_dump -U postgres lobechat \
  | gzip > "$BACKUP_DIR/lobechat-$(date +%F).sql.gz"
find "$BACKUP_DIR" -name '*.sql.gz' -mtime +14 -delete
```

### What to monitor

| Signal                        | Alert threshold           |
| ----------------------------- | ------------------------- |
| HTTP 5xx on `APP_URL`         | Any sustained             |
| Disk usage on `./data` volume | > 80%                     |
| `docker compose ps` unhealthy | Any service               |
| `/_spa/assets/*.js`           | Not HTTP 200 after deploy |
| Container restarts            | > 3/hour                  |

Optional: Grafana stack in `docker-compose/production/grafana/`.

---

## 6. Post-deploy bootstrap

### Control plane (required for OpenRouter key management)

`moz` starts the control plane automatically (`aico-control-plane` on port `3020`).
UI and API share that port. Put the management key only in the repo root `.env` — the
product container clears it and talks to the control plane via `AICO_CONTROL_PLANE_URL`

- `AICO_CONTROL_PLANE_SERVICE_TOKEN`.

```bash
# repo root .env (loaded by moz)
OPENROUTER_MANAGEMENT_API_KEY=sk-or-v1-...
AICO_CONTROL_PLANE_SERVICE_TOKEN=long-random-token
AICO_CONTROL_PLANE_PORT=3020

moz -u # builds control-plane SPA+API and deploys with the product stack
# Admin UI: http://127.0.0.1:3020/
```

Without moz, run `@aico/control-plane` as a separate process:

```bash
# control plane
export AICO_IS_CONTROL_PLANE=1
export OPENROUTER_MANAGEMENT_API_KEY=sk-or-v1-...
export AICO_CONTROL_PLANE_SERVICE_TOKEN=long-random-token
export AICO_CONTROL_PLANE_PORT=3020
pnpm --filter @aico/control-plane build
pnpm --filter @aico/control-plane start

# product server — no management key
export AICO_CONTROL_PLANE_URL=https://admin.example.com
export AICO_CONTROL_PLANE_SERVICE_TOKEN=long-random-token
# OPENROUTER_MANAGEMENT_API_KEY must be unset on the product server
```

Operator UI: control-plane origin `/` (requires a `platform_admins` session).

### Platform admin (do once)

```bash
# 1. Sign up first user via UI
# 2. Get user id
docker exec lobe-postgres psql -U postgres -d lobechat -c \
  "SELECT id, email FROM users ORDER BY created_at LIMIT 5;"

# 3. Grant admin (id column required)
docker exec lobe-postgres psql -U postgres -d lobechat -c \
  "INSERT INTO platform_admins (id, user_id)
   VALUES ('padm_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), 'USER_ID')
   ON CONFLICT (user_id) DO NOTHING;"
```

Prefer control-plane tRPC `platformAdmin.addPlatformAdmin` when you already have an admin session.

---

## 7. Staging before production

Mirror production topology in staging:

1. Same reverse proxy + CDN setup
2. Run `verify-deployment.sh` against staging URL
3. Test: sign-up, chat, image upload, OAuth callback
4. Deploy to production only after verify passes

---

## 8. Common anti-patterns

| Anti-pattern                               | Why it's bad                       | Fix                          |
| ------------------------------------------ | ---------------------------------- | ---------------------------- |
| `APP_URL=http://IP:3210` with public users | OAuth breaks, mixed content        | Use domain + HTTPS           |
| Exposed Postgres on 5432                   | Brute-force / data leak            | Remove port mapping          |
| `docker compose pull` without backup       | No rollback path                   | Backup first                 |
| CDN caching HTML                           | Stale SPA chunk refs after deploy  | `no-cache` on HTML routes    |
| Skipping `build:spa:copy` in custom builds | 500 on `/_spa/assets/*`            | Full `build:docker` pipeline |
| Same secrets dev → prod                    | Compromised dev = compromised prod | Rotate per environment       |
