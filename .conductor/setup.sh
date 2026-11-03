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
  else
    log "ERROR: Failed to create .env symlink"
  fi
else
  log "WARNING: $CONDUCTOR_ROOT_PATH/.env does not exist, skipping"
fi

log ""
log "--- Finding node_modules directories ---"

# Find all node_modules directories (excluding .pnpm internal and .next build cache)
# NODE_MODULES_DIRS=$(find "$CONDUCTOR_ROOT_PATH" -maxdepth 3 -name "node_modules" -type d 2>/dev/null | grep -v ".pnpm" | grep -v ".next")

# log "Found node_modules directories:"
# echo "$NODE_MODULES_DIRS" >> "$LOG_FILE"

# log ""
# log "--- Creating node_modules symlinks ---"

# # Counter for statistics
# total=0
# success=0
# failed=0

# for dir in $NODE_MODULES_DIRS; do
#   total=$((total + 1))

#   # Get relative path by removing CONDUCTOR_ROOT_PATH prefix
#   rel_path="${dir#$CONDUCTOR_ROOT_PATH/}"
#   parent_dir=$(dirname "$rel_path")

#   log "Processing: $rel_path"
#   log "  Source: $dir"
#   log "  Parent dir: $parent_dir"

#   # Create parent directory if needed
#   if [ "$parent_dir" != "." ]; then
#     if [ ! -d "$parent_dir" ]; then
#       mkdir -p "$parent_dir"
#       log "  Created parent directory: $parent_dir"
#     fi
#   fi

#   # Create symlink
#   ln -sf "$dir" "$rel_path"

#   # Verify symlink was created
#   if [ -L "$rel_path" ]; then
#     log "  SUCCESS: $rel_path -> $(readlink "$rel_path")"
#     success=$((success + 1))
#   else
#     log "  ERROR: Failed to create symlink for $rel_path"
#     failed=$((failed + 1))
#   fi

#   log ""
# done

log "=========================================="
log "Setup Complete"
log "=========================================="
log "Total node_modules: $total"
log "Successful symlinks: $success"
log "Failed symlinks: $failed"
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
