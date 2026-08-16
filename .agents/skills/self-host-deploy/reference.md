# Self-Host Deploy — Reference

## Architecture

```
Browser ──► Reverse proxy / CDN ──► lobehub:3210 (Next.js + SPA)
                                      ├── PostgreSQL (lobe-postgres)
                                      ├── Redis (lobe-redis)
                                      └── RustFS S3 (lobe-rustfs:9000)
```

- **HTML shell**: Next.js rewrites page requests to `/spa/[variants]/…` route handlers.
- **JS/CSS chunks**: Static files in `public/_spa`, `public/_spa-auth`, `public/_spa-workbench`.
- **API**: `/api`, `/trpc`, `/webapi` bypass SPA rewrite (middleware matcher excludes them).

## Environment variables

### Required (server DB mode)

| Variable                                    | Purpose                                                   |
| ------------------------------------------- | --------------------------------------------------------- |
| `AUTH_SECRET`                               | Session signing — generate with `openssl rand -base64 32` |
| `KEY_VAULTS_SECRET`                         | Encrypts stored API keys — `openssl rand -base64 32`      |
| `DATABASE_URL`                              | Postgres connection string                                |
| `APP_URL`                                   | Public URL browsers use                                   |
| `INTERNAL_APP_URL`                          | In-container self-calls (`http://localhost:3210`)         |
| `S3_ENDPOINT`                               | **Browser-reachable** S3 URL for chat image uploads       |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | RustFS credentials                                        |
| `S3_BUCKET`                                 | Bucket name (default `lobe`)                              |
| `REDIS_URL`                                 | `redis://redis:6379` in compose                           |

### Common optional

| Variable                        | Purpose                                         |
| ------------------------------- | ----------------------------------------------- |
| `AUTH_ALLOWED_EMAILS`           | Comma-separated allowlist                       |
| `AUTH_DISABLE_EMAIL_PASSWORD=1` | SSO-only                                        |
| `AUTH_TRUSTED_ORIGINS`          | Extra origins for Better Auth (comma-separated) |
| `AUTH_SSO_PROVIDERS`            | `google`, `github`, `microsoft`, …              |
| `LOBE_PORT`                     | Host port mapping (default 3210)                |

## Domain mode checklist

1. DNS A/AAAA → server IP
2. TLS certificate (Let's Encrypt / ArvanCloud / Cloudflare Full Strict)
3. Proxy `chat.example.com:443` → `localhost:3210` (all paths)
4. Proxy `s3.example.com:443` → `localhost:9000` (S3 for uploads)
5. `.env`: `APP_URL=https://chat.example.com`, `S3_ENDPOINT=https://s3.example.com`
6. `AUTH_TRUSTED_ORIGINS=https://chat.example.com`
7. Run verify script

## ArvanCloud / CDN notes

Observed failure pattern on `chat.panafor.com`:

- `/_spa/icons/*` → 200
- `/_spa/assets/*.js` → 500
- `/_spa-auth/assets/*.js` → 500

This indicates either:

1. **Incomplete image** — `public/_spa/assets/` empty in container (rebuild with full `build:docker`).
2. **CDN rule** — path-based rule intercepting `/assets` or `*.js` under `/_spa*`.
3. **Stale deployment** — HTML references old chunk hashes after partial update.

CDN fix: ensure `/_spa/*` and `/_spa-auth/*` pass through to origin with no path rewrite. Disable "static asset optimization" that strips unknown extensions.

## SPA chunk error (deep dive)

Browser error:

```
TypeError: Failed to fetch dynamically imported module:
  https://example.com/_spa/assets/_layout-XXXX.js
```

Server-side causes:

| HTTP status      | Meaning                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| 404              | Chunk hash stale or never deployed — hard refresh; if persists, rebuild |
| 500              | Origin error or CDN misroute — check container files + proxy            |
| 200 + wrong MIME | Proxy returning HTML error page — fix CDN                               |

In-container diagnosis:

```bash
docker exec lobehub ls -la /app/public/_spa/assets/ | wc -l # expect dozens+
docker exec lobehub ls -la /app/public/_spa-auth/assets/ | wc -l
docker exec lobehub ls -la /app/public/_spa/vendor/ | head
```

If counts are 0 or 2 (only `.` and `..`): image built without SPA copy step.

Rebuild:

```bash
docker build --no-cache -t aico/lobehub:latest .
docker compose up -d --force-recreate lobe
```

Client-side: app listens for `vite:preloadError` and reloads once (`src/utils/chunkError.ts`). If reload doesn't help, it's a server problem.

## Platform admin

Table: `platform_admins` — columns `id` (text PK), `user_id` (FK → users), `created_at`.

- IDs use prefix `padm_` + 12-char nanoid (set by Drizzle `$defaultFn`, not Postgres DEFAULT).
- Raw `INSERT` without `id` fails: `null value in column "id"`.
- App helper: `OrganizationModel.addPlatformAdmin(userId)` via tRPC `platformAdmin.addPlatformAdmin`.

List admins:

```sql
SELECT pa.id, pa.user_id, u.email
FROM platform_admins pa
JOIN users u ON u.id = pa.user_id;
```

## Local moz data dir (PanaChat)

Local builds via `moz` / `scripts/deploy-local.sh` persist data under:

| Data                         | Where                                                        |
| ---------------------------- | ------------------------------------------------------------ |
| **Postgres**                 | Docker named volume `panachat_postgres_data`                 |
| **Redis**                    | Docker named volume `panachat_redis_data`                    |
| **RustFS**                   | Docker named volume `panachat_rustfs_data`                   |
| Fingerprint / leftover binds | `PANACHAT_DATA_DIR` (default `~/.local/share/panachat-data`) |

Compose: `docker-compose.aico.data.override.yml`. **`moz -u` / `moz -d` do not delete** the volume or data dir — they only recreate containers.

### Why named volumes

Docker Desktop + WSL2 sometimes reports a **bind** mount in `docker inspect` while the container actually gets **tmpfs** (empty RAM). Postgres then `initdb`s → 0 users; Redis/RustFS look empty while the real files still sit on the host path. Named volumes live in Docker’s Linux VM and avoid that failure mode. `moz` also refuses to mark a deploy healthy if PGDATA is tmpfs or missing `PG_VERSION`.

### Symptom: users / platform admins “missing” after redeploy

Diagnose:

```bash
docker exec lobe-postgres df -T /var/lib/postgresql/data
# Good: not tmpfs (overlay/ext4/…)
# Bad:  tmpfs / none

docker inspect lobe-postgres --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}} {{.Name}}{{end}}{{end}}'
# Expect: volume panachat_postgres_data

./scripts/deploy-local.sh -i
```

Recover:

```bash
moz -k
# If volume empty but legacy bind still has data, moz -d migrates automatically:
#   ~/.local/share/panachat-data/postgres → volume panachat_postgres_data
moz -d
docker exec lobe-postgres df -T /var/lib/postgresql/data # must NOT be tmpfs
moz -i
```

If still tmpfs: restart Docker Desktop, then `moz -d` again.

**Never** `docker volume rm panachat_postgres_data` unless you intend a wipe. Prefer SQL restore from `~/.local/share/panachat-backups/`.

## Database reset (destructive)

Only when the user explicitly wants to wipe data:

```bash
moz -k
docker volume rm panachat_postgres_data
# optional: also remove legacy cold copy
# rm -rf "${PANACHAT_DATA_DIR:-$HOME/.local/share/panachat-data}/postgres"
MOZ_ALLOW_EMPTY_DB=1 moz -d
```

Upstream-style `./data` wipe is obsolete for Aico local moz deploys.

Migrations run automatically on container start (`docker.cjs`).

## Custom compose without setup.sh

```bash
curl -O https://raw.githubusercontent.com/lobehub/lobehub/HEAD/docker-compose/deploy/docker-compose.yml
curl -O https://raw.githubusercontent.com/lobehub/lobehub/HEAD/docker-compose/deploy/.env.example
mv .env.example .env
# edit .env
docker compose up -d
```

## Resource sizing

| Tier        | CPU | RAM   | Disk       |
| ----------- | --- | ----- | ---------- |
| Dev / light | 2   | 4 GB  | 20 GB      |
| Production  | 4+  | 8 GB+ | 50 GB+ SSD |

## Backup / restore

```bash
moz -B # dump now (refuses tmpfs / empty-vs-fingerprint)
moz --restore ~/.local/share/panachat-backups/panachat-….sql.gz
./scripts/panachat-backup.sh --list
./scripts/panachat-backup.sh --install-cron # daily 03:00

# Or raw:
docker exec lobe-postgres pg_dump -U postgres lobechat | gzip > backup.sql.gz
```

Dumps use `pg_dump` against the running container (named volume `panachat_postgres_data`).
Meta files record `postgres_volume`, `pgdata_fstype`, and `users`.

## Production best practices

See [best-practices.md](best-practices.md) for the full checklist. Templates:

- `templates/production.env.example` — production `.env` starter
- `templates/docker-compose.production.override.yml` — bind localhost, hide internal ports
