---
name: self-host-deploy
description: >-
  Deploy Aico self-hosted with Docker Compose — zero to production.
  Covers setup.sh, custom domain, reverse proxy/CDN, build-from-source,
  platform admin bootstrap, production hardening, and SPA chunk troubleshooting.
  Use when the user asks to deploy, self-host, docker compose, production setup,
  domain config, platform admin, best practices, or errors like "Failed to fetch
  dynamically imported module" on /_spa/assets.
user-invocable: true
---

# Aico Deploy (Zero → Production)

## Choose a path

| Goal                              | Path                                                      |
| --------------------------------- | --------------------------------------------------------- |
| Fastest start, upstream image     | [Official image](#path-a-official-image)                  |
| Custom Aico code / fork           | [Build from source](#path-b-build-from-source)            |
| Already deployed, something broke | [Verify](#verification) → [Troubleshooting](reference.md) |

---

## Path A: Official image

### 1. Server prerequisites

- Linux or macOS (Windows → WSL2)
- Docker + Docker Compose v2
- Free ports: `3210` (app), `9000` (S3), `5432` (optional external DB access)
- Min 2 CPU / 4 GB RAM

### 2. Run setup script

```bash
mkdir lobehub && cd lobehub
bash <(curl -fsSL https://lobe.li/setup.sh) -l en
```

Modes: **local** (localhost only) · **port** (LAN/IP) · **domain** (HTTPS + reverse proxy).

### 3. Start stack

```bash
docker compose up -d
docker logs -f lobehub # wait for "database migration pass" + "Ready"
```

### 4. Configure `.env` (domain / production)

Minimum overrides for a public domain like `https://chat.example.com`:

```env
APP_URL=https://chat.example.com
INTERNAL_APP_URL=http://localhost:3210
S3_ENDPOINT=https://s3.example.com # browser-reachable, NOT rustfs:9000
AUTH_TRUSTED_ORIGINS=https://chat.example.com
```

`INTERNAL_APP_URL` must be reachable **inside** the container (`http://localhost:3210` or `http://lobe:3210`). `APP_URL` is what browsers and OAuth use.

Restart after edits: `docker compose up -d lobe`

### 5. Production hardening (before going public)

# Deploy from repo: docker-compose/deploy/

# cp .env.example.aico .env

# cp docker-compose/deploy/.env.example.aico docker-compose/deploy/.env

# ./scripts/deploy-local.sh

Full checklist: [best-practices.md](best-practices.md)

---

## Path B: Build from source

Use when deploying this repo (Aico fork) with custom changes.

```bash
# From repo root
docker build -t aico/lobehub:latest .

# In deploy directory — point compose at your image
# docker-compose/deploy/docker-compose.aico.override.yml → image: aico/lobehub:local
./scripts/deploy-local.sh
```

Build pipeline inside Dockerfile runs: `build:spa` → `build:spa:mobile` → `build:spa:auth` → `build:spa:workbench` → `build:spa:copy` → `next build`. Never skip `build:spa:copy` — it publishes JS chunks to `public/_spa*`.

---

## Reverse proxy / CDN

Proxy **all** paths to port `3210`. SPA static assets live at:

- `/_spa/assets/*` — main app JS/CSS
- `/_spa-auth/assets/*` — sign-in/sign-up
- `/_spa/icons/*`, `/_spa-auth/favicon.ico`

**Do not** add CDN rules that rewrite or block `/_spa*/assets/*`. A common failure: icons return 200 but JS chunks return 500/404 → browser shows `Failed to fetch dynamically imported module`.

Nginx minimum:

```nginx
location / {
    proxy_pass http://127.0.0.1:3210;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Full proxy/CDN notes: [reference.md](reference.md)

---

## Post-deploy bootstrap

### 1. Create first user

Open `APP_URL`, sign up with email/password (or configure SSO in `~/Aico/.env`).

### 2. Grant platform admin

Find user id (Clerk-style id in `users` table):

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c \
  "SELECT id, email FROM users ORDER BY created_at LIMIT 5;"
```

Insert platform admin — **`id` is required** (Drizzle default, not a DB default):

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c \
  "INSERT INTO platform_admins (id, user_id)
   VALUES ('padm_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12), 'USER_ID_HERE')
   ON CONFLICT (user_id) DO NOTHING;"
```

Replace `USER_ID_HERE` with the `id` from `users`. Platform admin pages: `/platform`.

---

## Verification

Run the bundled checker (pass your public URL):

```bash
bash .claude/skills/self-host-deploy/scripts/verify-deployment.sh https://chat.example.com
```

Manual spot-checks:

```bash
# App up
curl -sI https://chat.example.com/ | head -3

# SPA chunks must be 200, not 500/404
curl -sI https://chat.example.com/_spa/icons/icon-192x192.png | head -3
# Pick a current hash from page source:
curl -sI https://chat.example.com/_spa-auth/assets/index.auth-*.js | head -3

# Inside container — assets dir must be populated
docker exec lobehub ls /app/public/_spa/assets/ | head -5
docker exec lobehub ls /app/public/_spa-auth/assets/ | head -5
```

Expected: migration log in `docker logs lobehub`, sign-in page loads, JS assets return `200` with `content-type: application/javascript` or `text/javascript`.

---

## Operations cheat sheet

```bash
docker compose logs -f lobe                 # live logs
docker compose pull && docker compose up -d # update official image
docker compose exec postgresql pg_dump -U postgres lobechat > backup.sql
docker compose down && sudo rm -rf ./data && docker compose up -d # reset DB (destructive)
```

After deploy updates, users may need one hard refresh (`Ctrl+Shift+R`). The app auto-reloads once on chunk errors via `lobe-chunk-reload` session flag.

---

## Troubleshooting quick hits

| Symptom                                                           | Likely cause                                             | Fix                                                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `Failed to fetch dynamically imported module` on `/_spa/assets/*` | Missing SPA build in image, or CDN/proxy blocking assets | Rebuild image; verify `/_spa/assets/*` returns 200; see [reference.md](reference.md) |
| `null value in column "id"` on `platform_admins`                  | Raw SQL without `id`                                     | Use insert with `padm_` prefix id (above)                                            |
| OAuth redirect mismatch                                           | Wrong `APP_URL`                                          | Set `APP_URL` to exact public URL; add to `AUTH_TRUSTED_ORIGINS`                     |
| Image upload in chat fails                                        | `S3_ENDPOINT` not browser-reachable                      | Use public domain, not `http://rustfs:9000`                                          |
| Async features silent fail                                        | Missing `INTERNAL_APP_URL`                               | Set `INTERNAL_APP_URL=http://localhost:3210`                                         |

Full troubleshooting: [reference.md](reference.md)

---

## Production best practices (summary)

| Area        | Rule                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| **Secrets** | Rotate `AUTH_SECRET`, `KEY_VAULTS_SECRET`, DB password — never use setup.sh defaults in prod              |
| **Network** | Only 80/443 public; bind `lobe` to `127.0.0.1`; remove Postgres/Redis port mappings                       |
| **URLs**    | `APP_URL` = HTTPS domain; `INTERNAL_APP_URL` = `http://localhost:3210`; `S3_ENDPOINT` = browser-reachable |
| **Access**  | Set `AUTH_ALLOWED_EMAILS` or SSO-only for private deployments                                             |
| **CDN**     | Pass `/_spa*` through unchanged; cache hashed assets, not HTML                                            |
| **Deploy**  | Backup → pull/rebuild → `verify-deployment.sh` → rollback plan ready                                      |
| **Updates** | Pin image tags; never `pull` without a DB backup                                                          |

Templates:

- [production.env.example](templates/production.env.example)
- [docker-compose.production.override.yml](templates/docker-compose.production.override.yml)

Complete guide: [best-practices.md](best-practices.md)
