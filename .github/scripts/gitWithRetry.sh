#!/usr/bin/env bash
set -euo pipefail

# A freshly minted App token can reach GitHub's Git backend before its authorization does.
status=0
for delay in 0 3 10 30; do
  if [ "$delay" -gt 0 ]; then
    echo "::warning::Git request failed; retrying in ${delay}s to allow GitHub App token propagation." >&2
    sleep "$delay"
  fi
  if git "$@"; then
    exit 0
  else
    status=$?
  fi
done

exit "$status"
