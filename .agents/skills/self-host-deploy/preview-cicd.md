# Panachat preview branch CI/CD

Staging stack on the **same VPS** as production, with its **own database** (and Redis / RustFS). Promote to prod by merging `preview` → `canary`.

## Why a separate DB

Preview runs real migrations and test traffic. Sharing prod Postgres/Redis/RustFS risks data loss and downtime. Preview volumes are always `panachat_preview_*` — never `panachat_*`.

## Git flow

```text
feature/*  →  preview  →  (smoke test)  →  canary  →  production VPS
                 │                              │
                 └─ deploy-preview.yml          └─ deploy-canary.yml
                    PANACHAT_ENV=preview           PANACHAT_ENV=canary
```

| Branch    | Workflow                                                              | Image tags       | Stack                                             |
| --------- | --------------------------------------------------------------------- | ---------------- | ------------------------------------------------- |
| `preview` | [`deploy-preview.yml`](../../../.github/workflows/deploy-preview.yml) | `:preview` + SHA | `panachat-preview` + `panachat_preview_*` volumes |
| `canary`  | [`deploy-canary.yml`](../../../.github/workflows/deploy-canary.yml)   | `:canary` + SHA  | `panachat` + `panachat_*` volumes                 |

## Isolation map

| Setting          | Preview                                                                 | Prod (canary)                   |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------- |
| Compose project  | `panachat-preview`                                                      | `panachat`                      |
| Volumes          | `panachat_preview_postgres_data` (etc.)                                 | `panachat_postgres_data` (etc.) |
| App ports        | `3220` / `3221`                                                         | `3210` / `3211`                 |
| RustFS host port | `9010` (example)                                                        | `9000`                          |
| App env          | `.env.preview`                                                          | `.env`                          |
| Infra env        | `docker-compose/deploy/.env.preview`                                    | `docker-compose/deploy/.env`    |
| State            | `/var/lib/panachat-preview/deploy.env`                                  | `/var/lib/panachat/deploy.env`  |
| Nginx upstream   | `panachat_preview_backend`                                              | `panachat_backend`              |
| Backup dir       | `~/…/panachat-preview-backups` (or `/var/lib/panachat-preview/backups`) | prod backup dir                 |

**Hard bans:** `docker compose down -v`, deleting `panachat_*` or `panachat_preview_*` volumes casually, pointing preview `DATABASE_URL` at prod.

## One-time server bootstrap (preview)

Assumes prod canary stack is already running on the same host and repo checkout (e.g. `~/panachat`).

```bash
cd ~/panachat # same checkout as prod

cp .env.example.preview .env.preview
cp docker-compose/deploy/.env.example.preview docker-compose/deploy/.env.preview
chmod 600 .env.preview docker-compose/deploy/.env.preview
# Use DISTINCT secrets, APP_URL=https://preview.…, ports 3220/3221, RUSTFS_PORT=9010

sudo cp docker-compose/deploy/nginx/panachat-preview-upstream.blue.conf \
  /etc/nginx/conf.d/panachat-preview-upstream.conf
# Enable docker-compose/deploy/nginx/panachat-preview-site.example.conf + TLS

export PANACHAT_IMAGE=ghcr.io/ < owner > /panachat:preview
PANACHAT_ENV=preview ./scripts/panachat-deploy-remote.sh bootstrap "$PANACHAT_IMAGE"
```

Create the long-lived GitHub branch once (from a good `canary`):

```bash
git fetch origin
git checkout canary
git pull --rebase origin canary
git checkout -b preview
git push -u origin preview
```

## Day-2 ops

```bash
PANACHAT_ENV=preview ./scripts/panachat-deploy-remote.sh status
PANACHAT_ENV=preview ./scripts/panachat-deploy-remote.sh rollback
PANACHAT_ENV=preview ./scripts/panachat-deploy-remote.sh deploy ghcr.io/<owner>/panachat:<sha>
```

Promote to production after smoke tests:

```bash
# Open PR preview → canary (or merge locally) so deploy-canary.yml runs
gh pr create --base canary --head preview --title "Promote preview to canary"
```

## Related

- Prod canary docs: [canary-cicd.md](canary-cicd.md)
- Deploy script: [`scripts/panachat-deploy-remote.sh`](../../../scripts/panachat-deploy-remote.sh)
- Compose: [`docker-compose.panachat.yml`](../../../docker-compose/deploy/docker-compose.panachat.yml)
