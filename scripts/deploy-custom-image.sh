#!/usr/bin/env bash

set -Eeuo pipefail

# Deploy a published custom image without touching database or storage volumes.
# Usage:
#   IMAGE=ghcr.io/lichao0223/lobehub TAG=canary ./scripts/deploy-custom-image.sh
#   IMAGE=ghcr.io/lichao0223/lobehub TAG=sha-abc123 ./scripts/deploy-custom-image.sh
#
# The deploy host must already contain the official Docker Compose deployment.
# COMPOSE_FILE points at that existing compose file; the script overlays only
# the lobe service image and leaves the original .env and volumes untouched.

DEPLOY_DIR="${DEPLOY_DIR:-/opt/lobehub/deploy}"
COMPOSE_FILE="${COMPOSE_FILE:-$DEPLOY_DIR/docker-compose.yml}"
IMAGE="${IMAGE:-ghcr.io/lichao0223/lobehub}"
TAG="${TAG:-canary}"
SERVICE="${SERVICE:-lobe}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
  echo "Deployment .env not found: $DEPLOY_DIR/.env" >&2
  exit 1
fi

IMAGE_REF="${IMAGE}:${TAG}"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_DIR/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp "$DEPLOY_DIR/.env" "$BACKUP_DIR/.env.$STAMP"

OVERRIDE_FILE="$(mktemp "${TMPDIR:-/tmp}/lobehub-compose.XXXXXX.yml")"
cleanup() {
  rm -f "$OVERRIDE_FILE"
}
trap cleanup EXIT

cat > "$OVERRIDE_FILE" <<EOF
services:
  $SERVICE:
    image: $IMAGE_REF
EOF

COMPOSE=(docker compose -f "$COMPOSE_FILE" -f "$OVERRIDE_FILE")

echo "Deploying $IMAGE_REF"
"${COMPOSE[@]}" config >/dev/null
"${COMPOSE[@]}" pull "$SERVICE"
"${COMPOSE[@]}" up -d --no-deps --wait "$SERVICE"

echo
echo "Deployment status:"
"${COMPOSE[@]}" ps "$SERVICE"
echo
echo "Recent application logs:"
"${COMPOSE[@]}" logs --tail=80 "$SERVICE"
