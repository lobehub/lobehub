#!/usr/bin/env bash
# Disable all upstream lobehub workflows in this fork, keeping only the
# fork-owned ones. Workflows are disabled via the GitHub Actions API
# (gh workflow disable), not by editing files — so this leaves no diff
# and produces no merge conflicts when pulling from upstream.
#
# Idempotent: already-disabled workflows are skipped. Re-run after a
# large upstream merge if it brought in brand-new workflow files.
#
# Requires: gh (authenticated), jq
# Usage:
#   deployment/homelab/scripts/disable-upstream-workflows.sh [--repo OWNER/REPO]

set -euo pipefail

REPO="mrsimpson/lobehub"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Keep in sync with .github/workflows/fork-validate.yml (FORK_OWNED_REGEX).
KEEP_RE='^(build-lobehub-image|deploy-homelab|fork-validate)\.yml$'

command -v gh >/dev/null || { echo "✗ gh CLI is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "✗ jq is required" >&2; exit 1; }

echo "→ Repo: $REPO"
echo "→ Keeping (regex): $KEEP_RE"
echo

mapfile -t CANDIDATES < <(
  gh workflow list --repo "$REPO" --all --limit 200 \
     --json name,path,state \
  | jq -r --arg keep "$KEEP_RE" '
      .[]
      | select((.path | sub("^\\.github/workflows/"; "")) | test($keep) | not)
      | select(.state != "disabled_manually")
      | (.path | sub("^\\.github/workflows/"; ""))
    '
)

if [[ ${#CANDIDATES[@]} -eq 0 ]]; then
  echo "✓ Nothing to disable."
  exit 0
fi

echo "Will disable ${#CANDIDATES[@]} workflow(s):"
printf '  - %s\n' "${CANDIDATES[@]}"
echo

for wf in "${CANDIDATES[@]}"; do
  printf '→ disabling %-40s ' "$wf"
  if gh workflow disable "$wf" --repo "$REPO" >/dev/null 2>&1; then
    echo "✓"
  else
    echo "✗ (skipped — already disabled or not dispatchable)"
  fi
done

echo
echo "✓ Done."
