# Panachat canary CI/CD (server)

Keep a single Linux VPS in sync with GitHub `canary`: build in Actions → private GHCR image → SSH blue-green deploy. Data plane (Postgres / Redis / RustFS) is never recreated.

## Architecture

| Piece          | Name                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Image          | `ghcr.io/<owner>/panachat:<sha>` and `:canary`                                                                    |
| Control-plane  | `ghcr.io/<owner>/panachat-control-plane:<sha>` and `:canary`                                                      |
| Compose        | [`docker-compose/deploy/docker-compose.panachat.yml`](../../../docker-compose/deploy/docker-compose.panachat.yml) |
| Deploy         | [`scripts/panachat-deploy-remote.sh`](../../../scripts/panachat-deploy-remote.sh)                                 |
| Workflow       | [`.github/workflows/deploy-canary.yml`](../../../.github/workflows/deploy-canary.yml)                             |
| State          | `/var/lib/panachat/deploy.env`                                                                                    |
| Nginx upstream | `panachat_backend` → `127.0.0.1:3210` (blue) or `:3211` (green)                                                   |
| Volumes        | `panachat_postgres_data`, `panachat_redis_data`, `panachat_rustfs_data`                                           |

**Hard bans:** `docker compose down -v`, `docker volume rm panachat_*`, wiping `PANACHAT_DATA_DIR` as if it were PGDATA.

## One-time server bootstrap

For the **kamyar VPS** (`https://chat.panafor.com` + `https://preview.panafor.com` + admin `https://adchat.panafor.com`), use the numbered Ubuntu 24.04 operator runbook (packages, env, DNS/TLS, first GHCR image, bootstrap):

→ **[SERVER-BOOTSTRAP.md](../../../docker-compose/deploy/SERVER-BOOTSTRAP.md)**

The steps below are the generic checklist (any host).

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

Set `APP_URL`, `AUTH_TRUSTED_ORIGINS` (include the admin origin), browser-reachable `S3_ENDPOINT`, `AICO_CONTROL_PLANE_PUBLIC_URL`, and `PANACHAT_IMAGE` / `PANACHAT_CONTROL_PLANE_IMAGE` (filled by deploy after first pull).

### 3. Private GHCR login

The repo may be public; the **`panachat` and `panachat-control-plane` packages must stay private**.

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

Optional control plane is now **part of CI**. Do not bind-mount the git checkout over `/app`. The image is `apps/aico-control-plane/Dockerfile` (SPA + `standalone.js`). First start still works via bootstrap; later pushes recreate `panachat-control-plane` only.

```bash
# Image pin is written to docker-compose/deploy/.env by the deploy script
# AICO_CONTROL_PLANE_SERVICE_TOKEN and AICO_CONTROL_PLANE_PUBLIC_URL live in repo-root .env
```

### 6. GitHub Actions secrets

| Secret            | Purpose                                               |
| ----------------- | ----------------------------------------------------- |
| `DEPLOY_HOST`     | Server hostname/IP                                    |
| `DEPLOY_USER`     | SSH user                                              |
| `DEPLOY_SSH_KEY`  | Private key                                           |
| `DEPLOY_PATH`     | Optional repo root on server (default `~/panachat`)   |
| `GHCR_READ_TOKEN` | PAT with `read:packages` for the server `docker pull` |

Every push to `canary` builds **both** images, `git fetch` + fast-forward on the VPS, then:

```bash
export PANACHAT_CONTROL_PLANE_IMAGE=ghcr.io/<owner>/panachat-control-plane:<sha>
PANACHAT_ENV=canary ./scripts/panachat-deploy-remote.sh deploy ghcr.io/<owner>/panachat:<sha>
```

That script blue/green-flips chat and then `docker compose --profile control-plane up -d --no-deps --force-recreate panachat-control-plane`. It never runs `docker compose down -v`.

Set `AICO_CONTROL_PLANE_PUBLIC_URL=https://adchat.panafor.com` (kamyar) and `AICO_INSECURE_AUTH_COOKIES=0` in `.env`.

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

- Aico product SemVer `0.9.1` (`AICO_PRODUCT_VERSION` in `packages/const`) unless `PANACHAT_VERSION` is set
- Channel tag `canary`
- Short Git SHA (click to copy full SHA)
- Build time when CI injected `BUILD_TIME`

Optional: create a GitHub Release / tag `v1.2.3` on `canary` so the next image shows that SemVer via `PANACHAT_VERSION` without changing LobeHub `package.json`.
