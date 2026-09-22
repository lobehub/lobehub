#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  cleanup.sh audit [--fetch] [--gh] [--stale-days <n>] [--base <ref>] [--noise <regex>]
  cleanup.sh clean [--gh] [--stale-days <n>] [--base <ref>] [--noise <regex>] \
                   --branch <name> [--branch <name> ...] [--apply]

Audit is read-only except for optional fetch/prune. Clean defaults to a dry run.

  --fetch          git fetch --prune the base remote first.
  --gh             Query GitHub PR state per branch (needs `gh`). Enables the
                   candidate-pr-merged / candidate-pr-closed classifications.
  --stale-days n   Treat a clean branch whose last commit is older than n days
                   and which has no unpushed commits as candidate-stale.
  --noise regex    Untracked paths matching this regex do not count as dirty
                   (default: node_modules|\.goal-tracing/). They are removed
                   together with the worktree.

Pass the same --gh / --stale-days / --noise flags to clean that you used for
audit, otherwise the pre-deletion re-classification will refuse the target.
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
use_gh=false
stale_days=0
noise_regex='node_modules|\.goal-tracing/'
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
    --gh)
      use_gh=true
      shift
      ;;
    --noise)
      (($# >= 2)) || die '--noise requires a regex'
      noise_regex=$2
      shift 2
      ;;
    --stale-days)
      (($# >= 2)) || die '--stale-days requires a number'
      [[ "$2" =~ ^[0-9]+$ ]] || die '--stale-days must be an integer'
      stale_days=$2
      shift 2
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

remote=${base_ref%%/*}
[[ "$remote" != "$base_ref" ]] || remote=origin

if $fetch_remote; then
  git fetch --prune "$remote"
fi

if $use_gh; then
  command -v gh >/dev/null 2>&1 || die '--gh requires the gh CLI'
fi

now_epoch=$(date +%s)

# ---------------------------------------------------------------------------
# Worktree enumeration. Emits: path <TAB> branch <TAB> prunable-reason
# Detached worktrees have an empty branch; broken registrations carry a reason.
# ---------------------------------------------------------------------------
list_worktrees() {
  git worktree list --porcelain | awk '
    BEGIN { RS=""; FS="\n" }
    {
      path=""; branch=""; prunable=""
      for (i=1; i<=NF; i++) {
        if ($i ~ /^worktree /) path=substr($i, 10)
        if ($i ~ /^branch refs\/heads\//) branch=substr($i, 19)
        if ($i ~ /^prunable/) prunable=substr($i, 10)
      }
      # Empty fields become "-" so consecutive tabs do not collapse under IFS.
      if (path != "") print path "\t" (branch == "" ? "-" : branch) "\t" (prunable == "" ? "-" : prunable)
    }
  '
}

branch_worktree() {
  list_worktrees | awk -F'\t' -v b="$1" '$2 == b { print $1; exit }'
}

worktree_is_usable() {
  local path=$1
  [[ -d "$path" ]] && git -C "$path" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

# Real dirt: any tracked change, plus untracked paths that do not match the
# noise regex. Noise: untracked paths that match it (safe to drop with --force).
dirty_count() {
  # grep exits 1 when nothing survives the filter; that is "clean", not an error.
  { git -C "$1" status --porcelain | grep -Ev "^\?\? .*(${noise_regex})" || true; } | wc -l | tr -d ' '
}

noise_count() {
  { git -C "$1" status --porcelain | grep -E "^\?\? .*(${noise_regex})" || true; } | wc -l | tr -d ' '
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

age_days() {
  local ct
  ct=$(git log -1 --format=%ct "$1")
  printf '%d' $(( (now_epoch - ct) / 86400 ))
}

# Commits on the branch that no ref on the remote can reach. Zero means every
# local commit already lives on the remote, so deleting the branch loses nothing.
unpushed_count() {
  git rev-list --count "$1" --not --remotes="$remote"
}

# Emits: number <TAB> state <TAB> tip_eq_head (eq|ne) — or "-\t-\t-" without --gh.
pr_info() {
  local branch=$1
  if ! $use_gh; then
    printf -- '-\t-\t-\n'
    return
  fi
  local raw number state head
  raw=$(gh pr list --state all --head "$branch" --limit 1 \
    --json number,state,headRefOid \
    --jq '.[0] | "\(.number)\t\(.state)\t\(.headRefOid)"' 2>/dev/null || true)
  if [[ -z "$raw" || "$raw" == $'null\tnull\tnull' ]]; then
    printf -- '-\t-\t-\n'
    return
  fi
  IFS=$'\t' read -r number state head <<<"$raw"
  if [[ "$(git rev-parse "$branch")" == "$head" ]]; then
    printf '%s\t%s\teq\n' "$number" "$state"
  else
    printf '%s\t%s\tne\n' "$number" "$state"
  fi
}

is_protected_branch() {
  local branch=$1
  local base_short=${base_ref#*/}
  [[ "$branch" == main || "$branch" == canary || "$branch" == "$base_ref" || "$branch" == "$base_short" ]]
}

# classify <branch> <worktree> <dirty> <age> <unpushed> <pr_state> <tip_eq>
classify() {
  local branch=$1 worktree=${2:-} dirty=${3:-0} age=${4:-0} unpushed=${5:-0}
  local pr_state=${6:--} tip_eq=${7:--}
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
  elif [[ "$pr_state" == MERGED && "$tip_eq" == eq ]]; then
    printf 'candidate-pr-merged'
  elif [[ "$pr_state" == MERGED ]]; then
    # Local tip moved past the PR head: check the extra commits by subject
    # against the base log before deleting.
    printf 'review-pr-merged-ahead'
  elif [[ "$pr_state" == CLOSED && ( "$tip_eq" == eq || "$unpushed" == 0 ) ]]; then
    printf 'candidate-pr-closed'
  elif [[ "$track" == '[gone]' && "$unpushed" == 0 ]]; then
    printf 'candidate-gone'
  elif [[ "$track" == '[gone]' ]]; then
    # Upstream pruned but local commits exist that no remote ref reaches.
    printf 'review-gone-unpushed'
  elif ((stale_days > 0 && age > stale_days && unpushed == 0)); then
    printf 'candidate-stale'
  elif [[ -z "$(upstream_name "$branch")" ]]; then
    printf 'review-no-upstream'
  else
    printf 'active'
  fi
}

print_header() {
  printf 'scope\tpath\tbranch\tdirty\tnoise\tage_days\tunpushed\tupstream\ttrack\tmerged_into_base\tpr\tpr_state\ttip_eq_pr\tclassification\n'
}

print_row() {
  local scope=$1 path=$2 branch=$3
  local dirty noise age unpushed upstream track merged pr_number pr_state tip_eq classification
  local worktree=''
  [[ "$scope" == worktree ]] && worktree=$path
  dirty=0; noise=0
  if [[ -n "$worktree" ]]; then
    dirty=$(dirty_count "$worktree")
    noise=$(noise_count "$worktree")
  fi
  age=$(age_days "$branch")
  unpushed=$(unpushed_count "$branch")
  upstream=$(upstream_name "$branch")
  track=$(upstream_track "$branch")
  if is_merged "$branch"; then merged=yes; else merged=no; fi
  IFS=$'\t' read -r pr_number pr_state tip_eq < <(pr_info "$branch") || true
  classification=$(classify "$branch" "$worktree" "$dirty" "$age" "$unpushed" "$pr_state" "$tip_eq")
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$scope" "$path" "$branch" "$dirty" "$noise" "$age" "$unpushed" \
    "${upstream:-none}" "${track:-none}" "$merged" "$pr_number" "$pr_state" "$tip_eq" "$classification"
}

audit() {
  print_header

  local bound_file
  bound_file=$(mktemp)
  trap 'rm -f "$bound_file"' RETURN

  while IFS=$'\t' read -r worktree branch prunable; do
    [[ -n "$worktree" ]] || continue
    [[ "$branch" != - ]] || branch=''
    [[ "$prunable" != - ]] || prunable=''
    if [[ -n "$prunable" ]] || ! worktree_is_usable "$worktree"; then
      # Registration points at a missing or gitdir-less directory. `git worktree
      # prune` drops the registration only; any leftover directory is reported
      # for the user to decide on.
      local reason=${prunable:-directory is not a git worktree}
      local present=missing
      [[ -d "$worktree" ]] && present=directory-present
      printf 'worktree\t%s\t%s\t?\t?\t-\t-\t-\t-\t-\t-\t-\t-\tbroken-registration(%s; %s)\n' \
        "$worktree" "${branch:--}" "$present" "$reason"
      [[ -n "$branch" ]] && printf '%s\n' "$branch" >> "$bound_file"
      continue
    fi
    if [[ -z "$branch" ]]; then
      local head dirty
      head=$(git -C "$worktree" rev-parse --short HEAD)
      dirty=$(dirty_count "$worktree")
      printf 'worktree\t%s\t(detached %s)\t%s\t%s\t-\t-\t-\t-\t-\t-\t-\t-\treview-detached\n' \
        "$worktree" "$head" "$dirty" "$(noise_count "$worktree")"
      continue
    fi
    printf '%s\n' "$branch" >> "$bound_file"
    print_row worktree "$worktree" "$branch"
  done < <(list_worktrees)

  while IFS= read -r branch; do
    grep -Fxq "$branch" "$bound_file" && continue
    print_row branch - "$branch"
  done < <(git for-each-ref refs/heads --format='%(refname:short)')
}

clean() {
  ((${#branches[@]} > 0)) || die 'clean requires at least one --branch'

  local branch worktree dirty noise age unpushed pr_number pr_state tip_eq classification
  for branch in "${branches[@]}"; do
    git show-ref --verify --quiet "refs/heads/$branch" || die "local branch not found: $branch"
    worktree=$(branch_worktree "$branch")
    dirty=0; noise=0
    if [[ -n "$worktree" ]]; then
      worktree_is_usable "$worktree" || die "$branch: worktree $worktree is a broken registration; run 'git worktree prune' and inspect the directory first"
      dirty=$(dirty_count "$worktree")
      noise=$(noise_count "$worktree")
    fi
    age=$(age_days "$branch")
    unpushed=$(unpushed_count "$branch")
    IFS=$'\t' read -r pr_number pr_state tip_eq < <(pr_info "$branch") || true
    classification=$(classify "$branch" "$worktree" "$dirty" "$age" "$unpushed" "$pr_state" "$tip_eq")

    case "$classification" in
      candidate-*) ;;
      *) die "$branch is $classification; refusing cleanup" ;;
    esac

    if ! $apply; then
      printf 'DRY-RUN\t%s\t%s\t%s\tnoise=%s\n' "$branch" "${worktree:--}" "$classification" "$noise"
      continue
    fi

    if [[ -n "$worktree" ]]; then
      if ((noise > 0)); then
        git worktree remove --force "$worktree"
      else
        git worktree remove "$worktree"
      fi
      printf 'REMOVED-WORKTREE\t%s\n' "$worktree"
    fi
    printf 'REMOVED-BRANCH\t%s\t%s\t(was %s)\n' "$branch" "$classification" "$(git rev-parse --short "$branch")"
    git branch -D "$branch" >/dev/null
  done
}

case "$command_name" in
  audit) audit ;;
  clean) clean ;;
  *) usage; exit 2 ;;
esac
