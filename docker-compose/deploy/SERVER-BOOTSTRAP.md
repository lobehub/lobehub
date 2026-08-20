# Panachat server bootstrap (kamyar VPS)

Numbered operator runbook for Ubuntu 24.04. Assumes GitHub **repository** secrets are already set (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PATH`, `GHCR_READ_TOKEN`) and the repo is cloned.

| Setting    | Value                                        |
| ---------- | -------------------------------------------- |
| Host       | `5.135.244.12`                               |
| SSH user   | `panachat`                                   |
| Repo path  | `/home/panachat/panachat`                    |
| Production | `https://chat.panafor.com`                   |
| Preview    | `https://preview.panafor.com` (own database) |
| Admin      | `https://adchat.panafor.com` (control plane) |
| Dozzle     | `https://dozzle.panafor.com` (Docker logs)   |
| Image      | `ghcr.io/panafor-ai-team/panachat`           |

**Hard bans:** never `docker compose down -v`; never `docker volume rm panachat_*` or `panachat_preview_*`; never point preview env at prod volumes.

Do not commit `.env` / `.env.preview` / `docker-compose/deploy/.env*`.

---

## 0. Already done (skip if true)

- [x] Repo secrets in GitHub Actions
- [x] `git clone https://github.com/Panafor-Ai-Team/Aico.git /home/panachat/panachat`
- [x] SSH key in `~/.ssh/authorized_keys` so Actions can log in without a password (`github-actions-panachat`)

---

## 1. Server packages

SSH as `panachat`. Install Docker Engine + Compose plugin, nginx, certbot, ufw.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx ufw

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker panachat
sudo systemctl enable --now docker nginx

sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

Log out and back in so the `docker` group applies. Check:

```bash
docker version
docker compose version
nginx -v
```

---

## 2. Repo on canary

```bash
cd /home/panachat/panachat
git checkout canary
git pull
```

---

## 3. Production env

```bash
cd /home/panachat/panachat
cp .env.example.panachat .env
cp docker-compose/deploy/.env.example.panachat docker-compose/deploy/.env
chmod 600 .env docker-compose/deploy/.env
```

Edit **both** files. Required:

- `APP_URL=https://chat.panafor.com`
- `AUTH_TRUSTED_ORIGINS=https://chat.panafor.com,https://adchat.panafor.com`
- `INTERNAL_APP_URL=http://localhost:3210`
- `AICO_CONTROL_PLANE_PUBLIC_URL=https://adchat.panafor.com`
- Rotate `AUTH_SECRET`, `KEY_VAULTS_SECRET`, `POSTGRES_PASSWORD`, `RUSTFS_SECRET_KEY`, `JWKS_KEY`, `AICO_CONTROL_PLANE_SERVICE_TOKEN` (do not keep example values)
- Browser-reachable `S3_ENDPOINT` (not `http://rustfs:9000`). One-level host only: `https://s3.panafor.com` → `127.0.0.1:9000` (never `s3.chat.*`)

Infra file (`docker-compose/deploy/.env`) should keep:

- `PANACHAT_STACK=panachat`
- `PANACHAT_VOLUME_PREFIX=panachat`
- `PANACHAT_PORT_BLUE=3210` / `PANACHAT_PORT_GREEN=3211`
- `POSTGRES_CONTAINER=panachat-postgres`
- `PANACHAT_CONTROL_PLANE_PORT=3020`
- `PANACHAT_CONTROL_PLANE_IMAGE` is filled by Deploy Canary (GHCR `panachat-control-plane:<sha>`)

---

## 4. Preview env (same VPS, own DB)

```bash
cd /home/panachat/panachat
cp .env.example.preview .env.preview
cp docker-compose/deploy/.env.example.preview docker-compose/deploy/.env.preview
chmod 600 .env.preview docker-compose/deploy/.env.preview
```

Use **different** secrets from prod. Set:

- `APP_URL=https://preview.panafor.com`
- `AUTH_TRUSTED_ORIGINS=https://preview.panafor.com`
- Ports `3220` / `3221`, `RUSTFS_PORT=9010`
- `PANACHAT_STACK=panachat-preview`
- `PANACHAT_VOLUME_PREFIX=panachat_preview`

---

## 5. DNS

A records (or AAAA) pointing at `5.135.244.12`:

- `chat.panafor.com`
- `preview.panafor.com`
- `adchat.panafor.com`
- `s3.panafor.com`
- `s3-preview.panafor.com`
- `mailer.panafor.com` — **DNS-only** (never CDN-proxied). Used for Stalwart WebAdmin HTTPS and SMTP STARTTLS.
- `dozzle.panafor.com` — **DNS-only** (never CDN-proxied / orange cloud). Dozzle via nginx `:443` → `127.0.0.1:8081`. Do not publish `:8081` on the public IP.

Inbound MX for `panafor.com` currently points at `mail.panafor.com` (`194.180.11.117`). Keep that MX if that box still receives `@panafor.com` mail. Do **not** switch MX to `mailer.panafor.com` unless you are moving inboxes onto kamyar.

For Panachat **sending** from kamyar, also publish (copy exact DKIM from Stalwart → Management → Domains → DNS):

- SPF TXT on `panafor.com` must **include** this VPS, e.g. `v=spf1 mx ip4:5.135.244.12 a:mailer.panafor.com -all` (merge with any existing SPF; do not drop `mail.panafor.com`)
- DKIM TXT `selector._domainkey.panafor.com` from Stalwart
- DMARC TXT `_dmarc.panafor.com` e.g. `v=DMARC1; p=quarantine; rua=mailto:noreply@panafor.com`

**OVH:** set reverse DNS / PTR for `5.135.244.12` → `mailer.panafor.com`. Unlock **outbound TCP 25** (OVH blocks it by default) or Gmail will not accept mail Stalwart tries to deliver.

Wait until `dig +short chat.panafor.com` returns the VPS IP (`5.135.244.12`). If you use ArvanCloud (or any CDN), **Cloud must be OFF** (DNS-only). Proxied A records hide the origin and HTTP-01 / nginx on this VPS never see the challenge.

---

## 6. Nginx (HTTP first, then TLS)

The deploy script copies an upstream file **as `panachat` (no sudo)** then runs `nginx -t` / `nginx -s reload`. Prepare ownership and a PATH wrapper so that works from Actions SSH.

```bash
cd /home/panachat/panachat
sudo cp docker-compose/deploy/nginx/panachat-upstream.blue.conf \
  /etc/nginx/conf.d/panachat-upstream.conf
sudo cp docker-compose/deploy/nginx/panachat-preview-upstream.blue.conf \
  /etc/nginx/conf.d/panachat-preview-upstream.conf
sudo chown panachat:panachat \
  /etc/nginx/conf.d/panachat-upstream.conf \
  /etc/nginx/conf.d/panachat-preview-upstream.conf

sudo tee /etc/sudoers.d/panachat-nginx > /dev/null << 'EOF'
panachat ALL=(root) NOPASSWD: /usr/sbin/nginx
panachat ALL=(root) NOPASSWD: /bin/cp, /usr/bin/cp
panachat ALL=(root) NOPASSWD: /bin/chown
EOF
sudo chmod 440 /etc/sudoers.d/panachat-nginx

# First on default PATH so `command -v nginx` is not /usr/sbin/nginx
sudo tee /usr/local/bin/nginx > /dev/null << 'EOF'
#!/bin/sh
exec sudo /usr/sbin/nginx "$@"
EOF
sudo chmod 755 /usr/local/bin/nginx
```

Copy the example sites and set hostnames:

```bash
sudo cp docker-compose/deploy/nginx/panachat-site.example.conf \
  /etc/nginx/sites-available/panachat
sudo cp docker-compose/deploy/nginx/panachat-preview-site.example.conf \
  /etc/nginx/sites-available/panachat-preview
sudo cp docker-compose/deploy/nginx/panachat-admin-site.example.conf \
  /etc/nginx/sites-available/panachat-admin
sudo cp docker-compose/deploy/nginx/panachat-s3-site.example.conf \
  /etc/nginx/sites-available/panachat-s3
sudo cp docker-compose/deploy/nginx/panachat-dozzle-site.example.conf \
  /etc/nginx/sites-available/panachat-dozzle
sudo sed -i 's/chat.example.com/chat.panafor.com/g' /etc/nginx/sites-available/panachat
sudo sed -i 's/preview.chat.example.com/preview.panafor.com/g' \
  /etc/nginx/sites-available/panachat-preview
sudo sed -i 's/admin.example.com/adchat.panafor.com/g' /etc/nginx/sites-available/panachat-admin
sudo sed -i 's/s3.example.com/s3.panafor.com/g' /etc/nginx/sites-available/panachat-s3
sudo sed -i 's/dozzle.example.com/dozzle.panafor.com/g' /etc/nginx/sites-available/panachat-dozzle
```

The examples 301 HTTP → HTTPS. Until Certbot has issued certs, comment out each `listen 443` server block and change the port-80 `return 301` to a `location /` that `proxy_pass`es `http://panachat_backend` (prod), `http://panachat_preview_backend` (preview), or `http://127.0.0.1:3020` (admin), matching the example `location /` headers.

```bash
sudo ln -sf /etc/nginx/sites-available/panachat /etc/nginx/sites-enabled/panachat
sudo ln -sf /etc/nginx/sites-available/panachat-preview /etc/nginx/sites-enabled/panachat-preview
sudo ln -sf /etc/nginx/sites-available/panachat-admin /etc/nginx/sites-enabled/panachat-admin
sudo ln -sf /etc/nginx/sites-available/panachat-s3 /etc/nginx/sites-enabled/panachat-s3
sudo ln -sf /etc/nginx/sites-available/panachat-dozzle /etc/nginx/sites-enabled/panachat-dozzle
# This host already serves developer.panafor.com from sites-enabled/default — do not delete it.
sudo /usr/sbin/nginx -t && sudo systemctl reload nginx
```

### Let's Encrypt (certbot)

1. Confirm DNS A records hit this VPS (`dig +short …` → `5.135.244.12`) with CDN/cloud **off**.
2. Serve **HTTP on port 80** first (comment out `listen 443` until certs exist, as above). `curl -I http://chat.panafor.com` should reach nginx on this host, not an Apache default page.
3. Issue certs (certbot edits the nginx site and adds HTTPS + redirect):

```bash
sudo certbot --nginx -d chat.panafor.com
sudo certbot --nginx -d adchat.panafor.com
sudo certbot --nginx -d preview.panafor.com
sudo certbot --nginx -d s3.panafor.com
sudo certbot --nginx -d mailer.panafor.com
sudo certbot --nginx -d dozzle.panafor.com
# optional: sudo certbot --nginx -d s3-preview.panafor.com
sudo /usr/sbin/nginx -t && sudo systemctl reload nginx
```

Renewal is `certbot.timer` (already installed with `python3-certbot-nginx`). Test with `sudo certbot renew --dry-run`.

`PANACHAT_SKIP_NGINX=1` is for debugging only — production needs the blue/green flip.

---

## 7. First GHCR image

On GitHub: **Actions** → **Deploy Panachat Canary** → **Run workflow** (branch `canary`).

Wait until **build** and **build-control-plane** push:

- `ghcr.io/panafor-ai-team/panachat:<sha>` and `:canary`
- `ghcr.io/panafor-ai-team/panachat-control-plane:<sha>` and `:canary`

Open org **Packages** and set both packages to **Private** if they are public.

You can skip the deploy job on first run (`skip_deploy`) until bootstrap env is ready; you still need a successful **push**. After bootstrap, every push to `canary` / `preview` deploys chat **and** restarts `panachat-control-plane` / `panachat-preview-control-plane` (`docker compose down -v` is never used).

---

## 8. GHCR login on the server

Classic PAT with `read:packages` (same value as `GHCR_READ_TOKEN`). Username = your GitHub username.

```bash
echo 'PASTE_TOKEN_ONCE' | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
docker pull ghcr.io/panafor-ai-team/panachat:canary
```

Do not paste the token into git or chat. After login, Docker stores credentials for the `panachat` user so later Actions SSH deploys can pull (Actions also logs in with `GHCR_READ_TOKEN` during the job).

---

## 9. Bootstrap production

State and fingerprint dirs must be writable by `panachat` (compose env uses `/var/lib/panachat/data`):

```bash
sudo mkdir -p /var/lib/panachat/data /var/lib/panachat/backups \
  /var/lib/panachat-preview/data /var/lib/panachat-preview/backups
sudo chown -R panachat:panachat /var/lib/panachat /var/lib/panachat-preview
```

```bash
cd /home/panachat/panachat
PANACHAT_ENV=canary ./scripts/panachat-deploy-remote.sh bootstrap \
  ghcr.io/panafor-ai-team/panachat:canary
```

Then:

```bash
./scripts/panachat-backup.sh --install-cron
PANACHAT_ENV=canary ./scripts/panachat-deploy-remote.sh status
```

Open `https://chat.panafor.com`. Sign up the first chat user separately from admin.

Admin UI: `https://adchat.panafor.com` (`AICO_CONTROL_PLANE_PUBLIC_URL` must match). Set `AICO_BOOTSTRAP_ADMIN_EMAIL` + `AICO_BOOTSTRAP_ADMIN_PASSWORD` on the control-plane service (independent from the chat password, even if the email matches). CI pulls the control-plane image and runs `compose --profile control-plane up -d --force-recreate panachat-control-plane`.

---

## 10. Preview (after prod is healthy)

On your laptop (not required on the VPS):

```bash
git fetch origin
git checkout canary && git pull
git checkout -b preview # only if origin/preview does not exist
git push -u origin preview
```

On the VPS, after a preview image exists (`:preview`):

```bash
cd /home/panachat/panachat
PANACHAT_ENV=preview ./scripts/panachat-deploy-remote.sh bootstrap \
  ghcr.io/panafor-ai-team/panachat:preview
```

Smoke-test `https://preview.panafor.com`. Promote with a PR `preview` → `canary`.

---

## 11. Verify

- `https://chat.panafor.com` loads; `/_spa/` assets return 200
- Settings → About shows version / `canary` / Git SHA after the versioned image is deployed
- From your laptop, key-based SSH: `ssh -i <deploy-key> panachat@5.135.244.12` (no password)

Day-2:

```bash
PANACHAT_ENV=canary ./scripts/panachat-deploy-remote.sh status
PANACHAT_ENV=canary ./scripts/panachat-deploy-remote.sh rollback
```

Architecture notes: [canary-cicd.md](../../.cursor/skills/self-host-deploy/canary-cicd.md), [preview-cicd.md](../../.cursor/skills/self-host-deploy/preview-cicd.md).

---

## 12. Mailer (Stalwart SMTP for Panachat)

Stalwart runs as a **separate** Docker container on this VPS (volumes `stalwart-etc`, `stalwart-data`). Nginx fronts **WebAdmin only**. SMTP stays on host ports 25 / 465 / 587.

Compose lives at `/home/panachat/stalwart/docker-compose.yml`. Publish 8080 on **loopback**: `'127.0.0.1:8080:8080'`. Nginx site: copy [`nginx/panachat-mailer-site.example.conf`](nginx/panachat-mailer-site.example.conf) to `/etc/nginx/sites-available/panachat-mailer`, `server_name mailer.panafor.com`, then certbot.

In Stalwart WebAdmin (`https://mailer.panafor.com/admin`):

1. Hostname = `mailer.panafor.com`
2. Domain = `panafor.com` (not `mailer.panafor.com`)
3. User `noreply@panafor.com` — this is `SMTP_USER` / `SMTP_PASS`
4. Copy DKIM/SPF from the domain DNS panel into ArvanCloud (DNS-only)

Panachat `/home/panachat/panachat/.env`:

```env
EMAIL_SERVICE_PROVIDER=nodemailer
SMTP_HOST=mailer.panafor.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@panafor.com
SMTP_PASS='…'
SMTP_FROM=Panachat <noreply@panafor.com>
```

Recreate the **active app slot** after env changes (`compose up -d --force-recreate panachat-green` or `panachat-blue`). Never `docker compose down -v`. App containers use `extra_hosts: mailer.panafor.com:host-gateway` so SMTP does not hairpin through the public IP.

Point Stalwart SMTP TLS at `/etc/letsencrypt/live/mailer.panafor.com/` (or a deploy-hook copy) so STARTTLS on 587 matches the hostname.
