#!/bin/bash

# Conductor workspace setup script
# This script prepares .env files and installs dependencies inside this worktree.

LOG_FILE="$PWD/.conductor-setup.log"

log() {
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] $1" | tee -a "$LOG_FILE"
}

log "=========================================="
log "Conductor Setup Script Started"
log "=========================================="
log "CONDUCTOR_ROOT_PATH: $CONDUCTOR_ROOT_PATH"
log "Current working directory: $PWD"
log ""

# Check if CONDUCTOR_ROOT_PATH is set
if [ -z "$CONDUCTOR_ROOT_PATH" ]; then
  log "ERROR: CONDUCTOR_ROOT_PATH is not set!"
  exit 1
fi

# Symlink .env file
log "--- Symlinking .env file ---"
if [ -f "$CONDUCTOR_ROOT_PATH/.env" ]; then
  ln -sf "$CONDUCTOR_ROOT_PATH/.env" .env
  if [ -L ".env" ]; then
    log "SUCCESS: .env symlinked -> $(readlink .env)"
  elif cp -f "$CONDUCTOR_ROOT_PATH/.env" .env; then
    # Windows without symlink privileges: ln -s copies the file but does not create a link.
    log "SUCCESS: .env copied (this filesystem cannot create symlinks)"
  else
    log "ERROR: Failed to provide .env"
  fi
else
  log "WARNING: $CONDUCTOR_ROOT_PATH/.env does not exist, skipping"
fi

# Docker Compose resolves service env_file relative to its compose file, not the
# repository root. Seed docker-compose/dev/.env from the source checkout so the
# database name and password stay aligned with DATABASE_URL.
COMPOSE_ENV_DIR="$PWD/docker-compose/dev"
COMPOSE_ENV="$COMPOSE_ENV_DIR/.env"
COMPOSE_ENV_SOURCE="$CONDUCTOR_ROOT_PATH/docker-compose/dev/.env"
log "--- Preparing Docker Compose environment ---"
if [ -f "$COMPOSE_ENV_SOURCE" ] && [ "$COMPOSE_ENV_SOURCE" != "$COMPOSE_ENV" ]; then
  mkdir -p "$COMPOSE_ENV_DIR"
  if cp -f "$COMPOSE_ENV_SOURCE" "$COMPOSE_ENV"; then
    log "SUCCESS: docker-compose/dev/.env copied from source checkout"
  else
    log "ERROR: Failed to copy docker-compose/dev/.env"
  fi
elif [ ! -f "$COMPOSE_ENV" ] && [ -f "$COMPOSE_ENV_DIR/.env.example" ]; then
  mkdir -p "$COMPOSE_ENV_DIR"
  if cp -f "$COMPOSE_ENV_DIR/.env.example" "$COMPOSE_ENV"; then
    log "SUCCESS: docker-compose/dev/.env seeded from .env.example"
  else
    log "ERROR: Failed to seed docker-compose/dev/.env"
  fi
else
  log "docker-compose/dev/.env already available, skipping"
fi

log ""
log "--- Ensuring workspace dependencies ---"

# node_modules must be installed inside this worktree. Next.js Turbopack refuses a
# node_modules link that escapes the project root ("Symlink [project]/node_modules
# is invalid, it points out of the filesystem root") and the dev server panics.
# Dev preflight only validates the root node_modules. Setup additionally cleans
# stale nested links left by the old Conductor symlink strategy.
WORKTREE_REAL_PATH=$(realpath "$PWD" 2>/dev/null)

is_inside_worktree() {
  case "$1" in
    "$WORKTREE_REAL_PATH"|"$WORKTREE_REAL_PATH"/*) return 0 ;;
    *) return 1 ;;
  esac
}

remove_escaping_node_modules_link() {
  local link="$1"

  # find -type l is not followed, and this guard keeps racing paths from deleting
  # a real directory. unlink is intentionally used instead of rm.
  if [ ! -L "$link" ]; then
    return 0
  fi

  local resolved
  if ! resolved=$(realpath "$link" 2>/dev/null); then
    log "WARNING: Cannot resolve node_modules link at $link; leaving it in place"
    return 0
  fi

  if is_inside_worktree "$resolved"; then
    log "Keeping node_modules link inside worktree: $link -> $resolved"
  elif unlink "$link"; then
    log "SUCCESS: Removed escaping node_modules link: $link -> $resolved"
  else
    log "ERROR: Failed to remove escaping node_modules link: $link"
  fi
}

if [ -z "$WORKTREE_REAL_PATH" ]; then
  log "ERROR: Cannot resolve the worktree path; skipping node_modules link cleanup"
else
  # The root link is handled explicitly because it is also the only path checked
  # by the Dev startup preflight; nested links are setup-only cleanup.
  remove_escaping_node_modules_link "node_modules"

  for SCAN_ROOT in packages packages/business apps e2e; do
    [ -d "$SCAN_ROOT" ] || continue
    while IFS= read -r -d '' link; do
      remove_escaping_node_modules_link "$link"
    done < <(find "$SCAN_ROOT" -maxdepth 4 -type l -name node_modules -print0 2>/dev/null)
  done
fi

NEEDS_INSTALL=false
if [ -e node_modules/.modules.yaml ] || [ -e node_modules/.pnpm ]; then
  log "node_modules is complete in this worktree, skipping install"
else
  NEEDS_INSTALL=true
  if [ -e node_modules ]; then
    log "node_modules exists but has neither .modules.yaml nor .pnpm; treating it as a partial install and reinstalling"
  fi
fi

if [ "$NEEDS_INSTALL" = true ] && command -v pnpm >/dev/null 2>&1; then
  log "Installing dependencies with pnpm install (this can take a few minutes)..."

  # Do not hard-code a public registry: that overrides a user's pnpm config,
  # including company/private mirrors and proxies. PNPM_REGISTRY is an explicit opt-in.
  PNPM_INSTALL_ARGS=()
  if [ -n "${PNPM_REGISTRY:-}" ]; then
    log "Using explicit PNPM_REGISTRY override for pnpm install"
    PNPM_INSTALL_ARGS=(--registry "$PNPM_REGISTRY")
  fi

  if pnpm install "${PNPM_INSTALL_ARGS[@]}" >> "$LOG_FILE" 2>&1; then
    log "SUCCESS: pnpm install finished"
  else
    log "ERROR: pnpm install failed; run it manually to see the full error"
  fi
elif [ "$NEEDS_INSTALL" = true ]; then
  log "ERROR: pnpm not found; install dependencies manually before starting dev"
fi

log ""

log "=========================================="
log "Setup Complete"
log "=========================================="
log ""

# List created symlinks for verification
log "--- Verification: Listing symlinks in workspace ---"
find . -maxdepth 1 -type l -exec ls -la {} \; 2> /dev/null >> "$LOG_FILE"
find ./packages -maxdepth 4 -type l -name "node_modules" -exec ls -la {} \; 2> /dev/null >> "$LOG_FILE"
find ./packages/business -maxdepth 4 -type l -name "node_modules" -exec ls -la {} \; 2> /dev/null >> "$LOG_FILE"
find ./apps -maxdepth 4 -type l -name "node_modules" -exec ls -la {} \; 2> /dev/null >> "$LOG_FILE"
find ./e2e -maxdepth 4 -type l -name "node_modules" -exec ls -la {} \; 2> /dev/null >> "$LOG_FILE"

log ""
log "Log file saved to: $LOG_FILE"
log "Setup script finished."
