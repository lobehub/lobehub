#!/bin/bash

# Conductor workspace setup script
# This script creates symlinks for .env and all node_modules directories

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
# Remove escaping links without following them. This makes repeated setup
# idempotent for worktrees created by the old Conductor symlink strategy.
if node -e "const fs=require('fs'); try { const s=fs.lstatSync('node_modules'); if (s.isSymbolicLink()) fs.unlinkSync('node_modules'); } catch (error) { if (error.code !== 'ENOENT') throw error; }"; then
  log "SUCCESS: escaping node_modules link removed (if present)"
else
  log "ERROR: Failed to remove node_modules link"
fi

if [ -d node_modules ]; then
  log "node_modules already present in this worktree, skipping install"
elif command -v pnpm >/dev/null 2>&1; then
  log "Installing dependencies with pnpm install (this can take a few minutes)..."
  if pnpm install --registry=https://registry.npmjs.org/ >> "$LOG_FILE" 2>&1; then
    log "SUCCESS: pnpm install finished"
  else
    log "ERROR: pnpm install failed; run it manually to see the full error"
  fi
else
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
find ./packages -maxdepth 2 -type l -name "node_modules" -exec ls -la {} \; 2> /dev/null >> "$LOG_FILE"
find ./apps -maxdepth 2 -type l -name "node_modules" -exec ls -la {} \; 2> /dev/null >> "$LOG_FILE"
find ./e2e -maxdepth 2 -type l -name "node_modules" -exec ls -la {} \; 2> /dev/null >> "$LOG_FILE"

log ""
log "Log file saved to: $LOG_FILE"
log "Setup script finished."
