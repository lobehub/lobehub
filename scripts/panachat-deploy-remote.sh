#!/usr/bin/env bash
# Panachat blue-green remote deploy (canary CI-CD).
#
# Usage:
#   ./scripts/panachat-deploy-remote.sh deploy <image-ref>   # e.g. ghcr.io/org/panachat:abc1234
#   ./scripts/panachat-deploy-remote.sh rollback
#   ./scripts/panachat-deploy-remote.sh bootstrap            # data plane + blue slot
#   ./scripts/panachat-deploy-remote.sh status
#
# Safety:
#   - Always runs panachat-backup.sh before deploy (unless PANACHAT_SKIP_BACKUP=1)
#   - Never runs `docker compose down -v` or removes panachat_* volumes
#   - Only starts/stops app slots; data plane stays up
#   - On failure, traffic stays on the current slot
#
# Env (optional):
#   PANACHAT_ROOT                 repo root (default: parent of scripts/)
#   PANACHAT_STATE_DIR            default /var/lib/panachat
#   PANACHAT_NGINX_UPSTREAM_FILE  default /etc/nginx/conf.d/panachat-upstream.conf
#   PANACHAT_PUBLIC_URL           for post-flip verify (e.g. https://chat.example.com)
#   PANACHAT_HEALTH_TIMEOUT_SEC   default 180
#   PANACHAT_IMAGE_KEEP           keep last N SHA images (default 5)
#   PANACHAT_SKIP_BACKUP=1
#   PANACHAT_SKIP_NGINX=1         skip upstream rewrite (manual proxy)
#   COMPOSE_PROFILES              e.g. control-plane

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${PANACHAT_ROOT:-$ROOT}"
DEPLOY_DIR="$ROOT/docker-compose/deploy"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.panachat.yml"
STATE_DIR="${PANACHAT_STATE_DIR:-/var/lib/panachat}"
STATE_FILE="$STATE_DIR/deploy.env"
NGINX_UPSTREAM="${PANACHAT_NGINX_UPSTREAM_FILE:-/etc/nginx/conf.d/panachat-upstream.conf}"
HEALTH_TIMEOUT="${PANACHAT_HEALTH_TIMEOUT_SEC:-180}"
IMAGE_KEEP="${PANACHAT_IMAGE_KEEP:-5}"
NETWORK_NAME="panachat-network"
APP_ALIAS="panachat-app"

PORT_BLUE="${PANACHAT_PORT_BLUE:-3210}"
PORT_GREEN="${PANACHAT_PORT_GREEN:-3211}"

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \?//'
  exit "${1:-0}"
}

log() { printf '==> %s\n' "$*"; }
err() { printf 'Error: %s\n' "$*" >&2; }

ensure_state_dir() {
  mkdir -p "$STATE_DIR"
}

load_state() {
  CURRENT_SLOT=blue
  DEPLOYED_SHA=
  PREVIOUS_SHA=
  PREVIOUS_SLOT=
  if [[ -f "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
  fi
  CURRENT_SLOT="${CURRENT_SLOT:-blue}"
}

write_state() {
  ensure_state_dir
  cat >"$STATE_FILE" <<EOF
CURRENT_SLOT=$1
DEPLOYED_SHA=$2
PREVIOUS_SLOT=${3:-}
PREVIOUS_SHA=${4:-}
UPDATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
}

slot_service() {
  case "$1" in
    blue) echo panachat-blue ;;
    green) echo panachat-green ;;
    *) err "unknown slot: $1"; return 1 ;;
  esac
}

slot_profile() {
  case "$1" in
    blue) echo slot-blue ;;
    green) echo slot-green ;;
    *) return 1 ;;
  esac
}

slot_port() {
  case "$1" in
    blue) echo "$PORT_BLUE" ;;
    green) echo "$PORT_GREEN" ;;
    *) return 1 ;;
  esac
}

other_slot() {
  case "$1" in
    blue) echo green ;;
    green) echo blue ;;
    *) return 1 ;;
  esac
}

compose() {
  (
    cd "$DEPLOY_DIR"
    # shellcheck disable=SC2086
    docker compose \
      --env-file ../../.env \
      --env-file .env \
      -f docker-compose.panachat.yml \
      "$@"
  )
}

compose_with_profile() {
  local profile="$1"
  shift
  (
    cd "$DEPLOY_DIR"
    docker compose \
      --env-file ../../.env \
      --env-file .env \
      -f docker-compose.panachat.yml \
      --profile "$profile" \
      "$@"
  )
}

set_image_env() {
  local image="$1"
  export PANACHAT_IMAGE="$image"
  # Persist for subsequent compose calls on this host
  local envf="$DEPLOY_DIR/.env"
  if [[ -f "$envf" ]]; then
    if grep -qE '^PANACHAT_IMAGE=' "$envf"; then
      sed -i.bak "s|^PANACHAT_IMAGE=.*|PANACHAT_IMAGE=${image}|" "$envf"
      rm -f "${envf}.bak"
    else
      printf '\nPANACHAT_IMAGE=%s\n' "$image" >>"$envf"
    fi
  else
    printf 'PANACHAT_IMAGE=%s\n' "$image" >"$envf"
  fi
}

run_backup() {
  if [[ "${PANACHAT_SKIP_BACKUP:-0}" == "1" ]]; then
    log "Skipping backup (PANACHAT_SKIP_BACKUP=1)"
    return 0
  fi
  log "Pre-deploy backup"
  export POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-panachat-postgres}"
  export LOBE_DB_NAME="${LOBE_DB_NAME:-${PANACHAT_DB_NAME:-lobechat}}"
  "$ROOT/scripts/panachat-backup.sh" --reason pre-deploy
}

wait_healthy() {
  local slot="$1"
  local port
  port="$(slot_port "$slot")"
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  local service
  service="$(slot_service "$slot")"
  log "Waiting for $service on 127.0.0.1:$port (timeout ${HEALTH_TIMEOUT}s)"

  while ((SECONDS < deadline)); do
    if ! docker inspect -f '{{.State.Running}}' "$service" 2>/dev/null | grep -q true; then
      sleep 2
      continue
    fi
    # Migration / ready signals in logs
    if docker logs "$service" 2>&1 | tail -n 200 | grep -qE 'database migration pass|Ready in |started server'; then
      local code
      code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${port}/signin" || echo 000)
      if [[ "$code" == "200" || "$code" == "302" || "$code" == "307" ]]; then
        log "$service is healthy (HTTP $code)"
        return 0
      fi
      code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${port}/" || echo 000)
      if [[ "$code" == "200" || "$code" == "302" || "$code" == "307" ]]; then
        log "$service is healthy (HTTP $code)"
        return 0
      fi
    fi
    sleep 3
  done

  err "$service did not become healthy within ${HEALTH_TIMEOUT}s"
  docker logs "$service" 2>&1 | tail -n 80 || true
  return 1
}

verify_slot_spa() {
  local port="$1"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${port}/_spa/icons/icon-192x192.png" || echo 000)
  if [[ "$code" != "200" ]]; then
    err "SPA icon check failed on :$port → HTTP $code"
    return 1
  fi
  log "SPA icon OK on :$port"
}

set_network_alias() {
  local service="$1"
  # Reconnect with alias so control-plane INTERNAL_APP_URL=http://panachat-app:3210 works
  docker network disconnect "$NETWORK_NAME" "$service" 2>/dev/null || true
  docker network connect --alias "$APP_ALIAS" "$NETWORK_NAME" "$service"
}

clear_network_alias() {
  local service="$1"
  # Disconnect/reconnect without alias (best-effort)
  if docker inspect "$service" >/dev/null 2>&1; then
    docker network disconnect "$NETWORK_NAME" "$service" 2>/dev/null || true
    docker network connect "$NETWORK_NAME" "$service" 2>/dev/null || true
  fi
}

flip_nginx() {
  local slot="$1"
  if [[ "${PANACHAT_SKIP_NGINX:-0}" == "1" ]]; then
    log "Skipping nginx flip (PANACHAT_SKIP_NGINX=1)"
    return 0
  fi
  local src="$DEPLOY_DIR/nginx/panachat-upstream.${slot}.conf"
  if [[ ! -f "$src" ]]; then
    err "Missing nginx template: $src"
    return 1
  fi
  if [[ ! -d "$(dirname "$NGINX_UPSTREAM")" ]]; then
    err "Nginx upstream dir missing: $(dirname "$NGINX_UPSTREAM") — set PANACHAT_NGINX_UPSTREAM_FILE or PANACHAT_SKIP_NGINX=1"
    return 1
  fi
  log "Flipping nginx upstream → $slot ($src → $NGINX_UPSTREAM)"
  cp "$src" "$NGINX_UPSTREAM"
  if command -v nginx >/dev/null 2>&1; then
    nginx -t
    nginx -s reload
  elif [[ -x /usr/sbin/nginx ]]; then
    /usr/sbin/nginx -t
    /usr/sbin/nginx -s reload
  else
    err "nginx binary not found; upstream file updated but not reloaded"
    return 1
  fi
}

prune_old_images() {
  local keep="$IMAGE_KEEP"
  local repo
  repo="$(echo "${PANACHAT_IMAGE:-}" | sed 's/:.*//')"
  [[ -n "$repo" ]] || return 0
  mapfile -t ids < <(docker images "$repo" --format '{{.ID}}' 2>/dev/null | awk -v k="$keep" 'NR>k')
  if ((${#ids[@]} == 0)); then
    return 0
  fi
  log "Pruning old $repo images (keep $keep)"
  for id in "${ids[@]}"; do
    [[ -n "$id" ]] || continue
    docker rmi "$id" 2>/dev/null || true
  done
}

image_sha_tag() {
  local image="$1"
  if [[ "$image" == *:* ]]; then
    echo "${image##*:}"
  else
    echo "$image"
  fi
}

cmd_status() {
  load_state
  echo "State file: $STATE_FILE"
  echo "CURRENT_SLOT=${CURRENT_SLOT:-}"
  echo "DEPLOYED_SHA=${DEPLOYED_SHA:-}"
  echo "PREVIOUS_SLOT=${PREVIOUS_SLOT:-}"
  echo "PREVIOUS_SHA=${PREVIOUS_SHA:-}"
  echo "PANACHAT_IMAGE=${PANACHAT_IMAGE:-}"
  docker ps --filter 'name=panachat-' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
}

cmd_bootstrap() {
  local image="${1:-}"
  if [[ -z "$image" ]]; then
    image="${PANACHAT_IMAGE:-}"
  fi
  if [[ -z "$image" ]]; then
    err "bootstrap requires image: $0 bootstrap ghcr.io/<owner>/panachat:<sha>"
    exit 1
  fi
  ensure_state_dir
  set_image_env "$image"
  log "Starting data plane + panachat-blue"
  compose up -d postgresql redis rustfs rustfs-init searxng
  compose_with_profile slot-blue up -d --no-deps panachat-blue
  set_network_alias panachat-blue
  wait_healthy blue
  verify_slot_spa "$PORT_BLUE"
  flip_nginx blue || true
  write_state blue "$(image_sha_tag "$image")" "" ""
  log "Bootstrap complete — active slot=blue"
}

cmd_deploy() {
  local image="${1:-}"
  if [[ -z "$image" ]]; then
    err "deploy requires image ref"
    usage 1
  fi

  load_state
  local active="$CURRENT_SLOT"
  local inactive
  inactive="$(other_slot "$active")"
  local active_svc inactive_svc
  active_svc="$(slot_service "$active")"
  inactive_svc="$(slot_service "$inactive")"
  local inactive_profile
  inactive_profile="$(slot_profile "$inactive")"
  local prev_sha="${DEPLOYED_SHA:-}"

  log "Active=$active → deploying $image onto $inactive"

  run_backup
  set_image_env "$image"

  log "Pulling $image"
  docker pull "$image"

  log "Starting inactive slot $inactive_svc"
  compose_with_profile "$inactive_profile" up -d --no-deps --force-recreate "$inactive_svc"

  if ! wait_healthy "$inactive"; then
    err "New slot unhealthy — leaving traffic on $active; stopping $inactive_svc"
    compose_with_profile "$inactive_profile" stop "$inactive_svc" || true
    exit 1
  fi

  if ! verify_slot_spa "$(slot_port "$inactive")"; then
    err "SPA verify failed — leaving traffic on $active; stopping $inactive_svc"
    compose_with_profile "$inactive_profile" stop "$inactive_svc" || true
    exit 1
  fi

  set_network_alias "$inactive_svc"
  if ! flip_nginx "$inactive"; then
    err "Nginx flip failed — leaving traffic on $active; clearing new alias"
    clear_network_alias "$inactive_svc" || true
    set_network_alias "$active_svc" || true
    compose_with_profile "$inactive_profile" stop "$inactive_svc" || true
    exit 1
  fi

  log "Stopping old slot $active_svc"
  local active_profile
  active_profile="$(slot_profile "$active")"
  compose_with_profile "$active_profile" stop "$active_svc" || true
  clear_network_alias "$active_svc" || true

  write_state "$inactive" "$(image_sha_tag "$image")" "$active" "$prev_sha"
  prune_old_images

  if [[ -n "${PANACHAT_PUBLIC_URL:-}" ]]; then
    local verify="$ROOT/.claude/skills/self-host-deploy/scripts/verify-deployment.sh"
    if [[ -x "$verify" ]]; then
      log "Verifying public URL ${PANACHAT_PUBLIC_URL}"
      bash "$verify" "$PANACHAT_PUBLIC_URL" "$inactive_svc" || true
    fi
  fi

  log "Deploy complete — active slot=$inactive image=$image"
}

cmd_rollback() {
  load_state
  if [[ -z "${PREVIOUS_SHA:-}" ]]; then
    err "No PREVIOUS_SHA in $STATE_FILE — cannot rollback"
    exit 1
  fi

  local image_repo
  image_repo="$(grep -E '^PANACHAT_IMAGE=' "$DEPLOY_DIR/.env" 2>/dev/null | cut -d= -f2- | sed 's/:.*//' || true)"
  if [[ -z "$image_repo" ]]; then
    err "Cannot resolve image repository from deploy .env"
    exit 1
  fi
  local image="${image_repo}:${PREVIOUS_SHA}"
  log "Rolling back to $image"
  cmd_deploy "$image"
}

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    deploy) cmd_deploy "${1:-}" ;;
    rollback) cmd_rollback ;;
    bootstrap) cmd_bootstrap "${1:-}" ;;
    status) cmd_status ;;
    -h|--help|help) usage 0 ;;
    *) usage 1 ;;
  esac
}

main "$@"
