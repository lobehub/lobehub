#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  cleanup.sh audit [--fetch] [--base <ref>]
  cleanup.sh clean [--base <ref>] --branch <name> [--branch <name> ...] [--apply]

Audit is read-only except for optional fetch/prune. Clean defaults to a dry run.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || die 'not inside a Git worktree'
common_dir=$(git rev-parse --git-common-dir)
if [[ "$common_dir" != /* ]]; then
  common_dir="$repo_root/$common_dir"
fi
common_dir=$(cd "$common_dir" && pwd -P)

command_name=${1:-}
[[ -n "$command_name" ]] || { usage; exit 2; }
shift

base_ref=origin/canary
fetch_remote=false
apply=false
branches=()

while (($#)); do
  case "$1" in
    --apply)
      apply=true
      shift
      ;;
    --base)
      (($# >= 2)) || die '--base requires a ref'
      base_ref=$2
      shift 2
      ;;
    --branch)
      (($# >= 2)) || die '--branch requires a local branch name'
      branches+=("$2")
      shift 2
      ;;
    --fetch)
      fetch_remote=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

git show-ref --verify --quiet "refs/remotes/$base_ref" \
  || git show-ref --verify --quiet "refs/heads/$base_ref" \
  || die "base ref does not exist: $base_ref"

if $fetch_remote; then
  remote=${base_ref%%/*}
  [[ "$remote" != "$base_ref" ]] || remote=origin
  git fetch --prune "$remote"
fi

branch_worktree() {
  local target="branch refs/heads/$1"
  git worktree list --porcelain | awk -v target="$target" '
    BEGIN { RS=""; FS="\n" }
    {
      path=""
      found=0
      for (i=1; i<=NF; i++) {
        if ($i ~ /^worktree /) path=substr($i, 10)
        if ($i == target) found=1
      }
      if (found) { print path; exit }
    }
  '
}

dirty_count() {
  git -C "$1" status --porcelain | wc -l | tr -d ' '
}

upstream_track() {
  git for-each-ref "refs/heads/$1" --format='%(upstream:track)'
}

upstream_name() {
  git for-each-ref "refs/heads/$1" --format='%(upstream:short)'
}

is_merged() {
  git merge-base --is-ancestor "$1" "$base_ref"
}

is_protected_branch() {
  local branch=$1
  local base_short=${base_ref#*/}
  [[ "$branch" == main || "$branch" == canary || "$branch" == "$base_ref" || "$branch" == "$base_short" ]]
}

classify() {
  local branch=$1
  local worktree=${2:-}
  local dirty=${3:-0}
  local track
  track=$(upstream_track "$branch")

  if is_protected_branch "$branch"; then
    printf 'protected-branch'
  elif [[ -n "$worktree" && "$(cd "$worktree" && pwd -P)" == "$(pwd -P)" ]]; then
    printf 'protect-current'
  elif ((dirty > 0)); then
    printf 'protect-dirty'
  elif is_merged "$branch"; then
    printf 'candidate-merged'
  elif [[ "$track" == '[gone]' ]]; then
    printf 'candidate-gone'
  elif [[ -z "$(upstream_name "$branch")" ]]; then
    printf 'review-no-upstream'
  else
    printf 'active'
  fi
}

audit() {
  printf 'scope\tpath\tbranch\tdirty\tupstream\ttrack\tmerged_into_base\tclassification\n'

  local bound_file
  bound_file=$(mktemp)
  trap 'rm -f "$bound_file"' RETURN

  while IFS=$'\t' read -r worktree branch; do
    [[ -n "$branch" ]] || continue
    printf '%s\n' "$branch" >> "$bound_file"
    local dirty upstream track merged classification
    dirty=$(dirty_count "$worktree")
    upstream=$(upstream_name "$branch")
    track=$(upstream_track "$branch")
    if is_merged "$branch"; then merged=yes; else merged=no; fi
    classification=$(classify "$branch" "$worktree" "$dirty")
    printf 'worktree\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$worktree" "$branch" "$dirty" "${upstream:-none}" "${track:-none}" "$merged" "$classification"
  done < <(
    git worktree list --porcelain | awk '
      BEGIN { RS=""; FS="\n" }
      {
        path=""; branch=""
        for (i=1; i<=NF; i++) {
          if ($i ~ /^worktree /) path=substr($i, 10)
          if ($i ~ /^branch refs\/heads\//) branch=substr($i, 19)
        }
        if (branch != "") print path "\t" branch
      }
    '
  )

  while IFS= read -r branch; do
    grep -Fxq "$branch" "$bound_file" && continue
    local upstream track merged classification
    upstream=$(upstream_name "$branch")
    track=$(upstream_track "$branch")
    if is_merged "$branch"; then merged=yes; else merged=no; fi
    classification=$(classify "$branch" '' 0)
    printf 'branch\t-\t%s\t0\t%s\t%s\t%s\t%s\n' \
      "$branch" "${upstream:-none}" "${track:-none}" "$merged" "$classification"
  done < <(git for-each-ref refs/heads --format='%(refname:short)')
}

clean() {
  ((${#branches[@]} > 0)) || die 'clean requires at least one --branch'

  local branch worktree dirty classification
  for branch in "${branches[@]}"; do
    git show-ref --verify --quiet "refs/heads/$branch" || die "local branch not found: $branch"
    worktree=$(branch_worktree "$branch")
    dirty=0
    [[ -z "$worktree" ]] || dirty=$(dirty_count "$worktree")
    classification=$(classify "$branch" "$worktree" "$dirty")

    case "$classification" in
      candidate-merged|candidate-gone) ;;
      *) die "$branch is $classification; refusing cleanup" ;;
    esac

    if ! $apply; then
      printf 'DRY-RUN\t%s\t%s\t%s\n' "$branch" "${worktree:--}" "$classification"
      continue
    fi

    if [[ -n "$worktree" ]]; then
      git worktree remove "$worktree"
      printf 'REMOVED-WORKTREE\t%s\n' "$worktree"
    fi
    git branch -D "$branch"
    printf 'REMOVED-BRANCH\t%s\n' "$branch"
  done
}

case "$command_name" in
  audit) audit ;;
  clean) clean ;;
  *) usage; exit 2 ;;
esac
