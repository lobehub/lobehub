# Panachat canary CI/CD (server)

Keep a single Linux VPS in sync with GitHub `canary`: build in Actions → private GHCR image → SSH blue-green deploy. Data plane (Postgres / Redis / RustFS) is never recreated.

## Architecture

| Piece          | Name                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Image          | `ghcr.io/<owner>/panachat:<sha>` and `:canary`                                                                    |
| Compose        | [`docker-compose/deploy/docker-compose.panachat.yml`](../../../docker-compose/deploy/docker-compose.panachat.yml) |
| Deploy         | [`scripts/panachat-deploy-remote.sh`](../../../scripts/panachat-deploy-remote.sh)                                 |
| Workflow       | [`.github/workflows/deploy-canary.yml`](../../../.github/workflows/deploy-canary.yml)                             |
| State          | `/var/lib/panachat/deploy.env`                                                                                    |
| Nginx upstream | `panachat_backend` → `127.0.0.1:3210` (blue) or `:3211` (green)                                                   |
| Volumes        | `panachat_postgres_data`, `panachat_redis_data`, `panachat_rustfs_data`                                           |

**Hard bans:** `docker compose down -v`, `docker volume rm panachat_*`, wiping `PANACHAT_DATA_DIR` as if it were PGDATA.

## One-time server bootstrap

### 1. Prerequisites

- Docker + Compose v2
- nginx (or Caddy with equivalent upstream flip)
- UFW: allow 22 / 80 / 443 only
- Git clone of this repo (or deploy checkout) at e.g. `~/panachat`

### 2. Env files

```bash
cp .env.example.panachat .env
cp docker-compose/deploy/.env.example.panachat docker-compose/deploy/.env
chmod 600 .env docker-compose/deploy/.env
# Rotate AUTH_SECRET, KEY_VAULTS_SECRET, POSTGRES_PASSWORD, RUSTFS_SECRET_KEY, JWKS_KEY
```

Set `APP_URL`, `AUTH_TRUSTED_ORIGINS`, browser-reachable `S3_ENDPOINT`, and `PANACHAT_IMAGE` (filled by deploy script after first pull).

### 3. Private GHCR login

The repo may be public; the **`panachat` package must stay private**.

```bash
# PAT with read:packages (classic) or fine-grained Packages read
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
```

After the first Actions push, confirm Package settings → **Private** (workflow tries to set this via API).

### 4. Nginx

```bash
sudo cp docker-compose/deploy/nginx/panachat-upstream.blue.conf \
  /etc/nginx/conf.d/panachat-upstream.conf
# Adapt and enable docker-compose/deploy/nginx/panachat-site.example.conf
sudo nginx -t && sudo systemctl reload nginx
```

### 5. First start (blue slot)

```bash
export PANACHAT_IMAGE=ghcr.io/ < owner > /panachat:canary # or a SHA tag
./scripts/panachat-deploy-remote.sh bootstrap "$PANACHAT_IMAGE"
./scripts/panachat-backup.sh --install-cron
```

Optional control plane (requires built `apps/aico-control-plane` on the checkout):

```bash
export COMPOSE_PROFILES=control-plane
# set AICO_CONTROL_PLANE_SERVICE_TOKEN in .env
docker compose -f docker-compose/deploy/docker-compose.panachat.yml \
  --env-file .env --env-file docker-compose/deploy/.env \
  --profile control-plane up -d panachat-control-plane
```

### 6. GitHub Actions secrets

| Secret            | Purpose                                               |
| ----------------- | ----------------------------------------------------- |
| `DEPLOY_HOST`     | Server hostname/IP                                    |
| `DEPLOY_USER`     | SSH user                                              |
| `DEPLOY_SSH_KEY`  | Private key                                           |
| `DEPLOY_PATH`     | Optional repo root on server (default `~/panachat`)   |
| `GHCR_READ_TOKEN` | PAT with `read:packages` for the server `docker pull` |

Every push to `canary` builds, pushes GHCR, then runs:

```bash
PANACHAT_ENV=canary ./scripts/panachat-deploy-remote.sh deploy ghcr.io/<owner>/panachat:<sha>
```

Manual: Actions → **Deploy Panachat Canary** → `workflow_dispatch` (optional skip deploy).

For staging before prod, use the **`preview`** branch and [preview-cicd.md](preview-cicd.md) (own database on the same VPS).

## Day-2 ops

```bash
PANACHAT_ENV=canary ./scripts/panachat-deploy-remote.sh status
PANACHAT_ENV=canary ./scripts/panachat-deploy-remote.sh rollback # previous SHA, blue-green
./scripts/panachat-backup.sh --reason manual
bash .claude/skills/self-host-deploy/scripts/verify-deployment.sh https://chat.example.com
```

App updates only touch `${PANACHAT_STACK}-blue` / `-green` (default `panachat-blue` / `panachat-green`). Data services stay up. Failed health checks leave traffic on the old slot.

## Near-zero downtime notes

- Nginx reload flips `panachat_backend` in under a second for normal releases.
- Breaking DB migrations can still require a careful window (old app + new schema). Prefer additive / expand-contract migrations.

## Version in the app

After deploy, open **Settings → About**. You should see:

- SemVer from `package.json` (or override from a `v*` Git tag via `PANACHAT_VERSION`)
- Channel tag `canary`
- Short Git SHA (click to copy full SHA)
- Build time when CI injected `BUILD_TIME`

Optional: create a GitHub Release / tag `v1.2.3` on `canary` so the next image shows that SemVer without auto-committing `package.json`.
