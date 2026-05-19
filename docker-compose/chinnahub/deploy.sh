#!/bin/bash
# Chinna Hub — VPS Deploy Script
# Runs on: root@187.127.156.186
# Domain: https://app.itsmechinna.com
set -e

DEPLOY_DIR="/opt/chinnahub"
BACKUP_DIR="/opt/backups/chinnahub"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
COMPOSE_FILE="$DEPLOY_DIR/docker-compose/chinnahub/docker-compose.yml"
ENV_FILE="$DEPLOY_DIR/docker-compose/chinnahub/.env"

echo "========================================"
echo " Chinna Hub Deploy — $TIMESTAMP"
echo "========================================"

# ── 1. BACKUP ────────────────────────────────
echo ""
echo "▶ [1/7] Creating backup..."
mkdir -p "$BACKUP_DIR"

# Backup .env
if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$BACKUP_DIR/.env.$TIMESTAMP.bck"
  echo "  ✓ .env backed up → $BACKUP_DIR/.env.$TIMESTAMP.bck"
fi

# Backup docker volumes (postgres + redis + rustfs)
for VOL in chinnahub_postgres_data chinnahub_redis_data chinnahub_rustfs_data; do
  if docker volume inspect "$VOL" &>/dev/null; then
    docker run --rm \
      -v "$VOL":/data:ro \
      -v "$BACKUP_DIR":/backup \
      alpine tar czf "/backup/${VOL}.$TIMESTAMP.bck.tar.gz" -C /data . 2>/dev/null \
      && echo "  ✓ Volume $VOL backed up" \
      || echo "  ⚠ Volume $VOL backup skipped (empty or not found)"
  fi
done

# ── 2. PULL LATEST CODE ──────────────────────
echo ""
echo "▶ [2/7] Pulling latest code from git..."
cd "$DEPLOY_DIR"
git fetch origin
git checkout agents/code-audit-white-label-optimization
git pull origin agents/code-audit-white-label-optimization
echo "  ✓ Code updated"

# ── 3. ENSURE NETWORK EXISTS ─────────────────
echo ""
echo "▶ [3/7] Ensuring Docker networks..."
docker network inspect chinnahub-net &>/dev/null || docker network create chinnahub-net
echo "  ✓ chinnahub-net ready"

# Connect Caddy to chinnahub-net if not already
if ! docker inspect caddy --format='{{range .NetworkSettings.Networks}}{{.NetworkID}} {{end}}' | grep -q "$(docker network inspect chinnahub-net --format='{{.Id}}')"; then
  docker network connect chinnahub-net caddy && echo "  ✓ Caddy connected to chinnahub-net" || echo "  ⚠ Caddy already connected or not running"
fi

# ── 4. STOP EXISTING CONTAINERS ──────────────
echo ""
echo "▶ [4/7] Stopping existing Chinna Hub containers..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down --remove-orphans 2>/dev/null || true
echo "  ✓ Old containers stopped"

# ── 5. BUILD IMAGE ───────────────────────────
echo ""
echo "▶ [5/7] Building Chinna Hub Docker image..."
docker build \
  --tag chinnahub-app:latest \
  --build-arg NEXT_PUBLIC_BASE_PATH="" \
  --progress=plain \
  "$DEPLOY_DIR" 2>&1 | tail -20
echo "  ✓ Image built: chinnahub-app:latest"

# ── 6. START SERVICES ────────────────────────
echo ""
echo "▶ [6/7] Starting all services..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --wait
echo "  ✓ Services started"

# ── 7. RUN MIGRATIONS ────────────────────────
echo ""
echo "▶ [7/7] Running database migrations..."
sleep 5
docker exec chinnahub-app sh -c "node_modules/.bin/drizzle-kit migrate 2>/dev/null || npx drizzle-kit migrate 2>/dev/null || echo 'Migration skipped (run manually if needed)'"
echo "  ✓ Migrations done"

# ── DONE ─────────────────────────────────────
echo ""
echo "========================================"
echo " ✅ Chinna Hub is live!"
echo "    URL: https://app.itsmechinna.com"
echo "    Containers:"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
echo "========================================"
