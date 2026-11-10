#!/usr/bin/env bash

set -euo pipefail

# The repo may be a partial clone: never let a probe for a missing object (an
# old PR head) trigger a network fetch per branch.
export GIT_NO_LAZY_FETCH=1

usage() {
  cat <<'EOF'
Usage:
  cleanup.sh audit [--fetch] [--gh] [--stale-days <n>] [--base <ref>] [--noise <regex>]
                   [--scratch <regex>]
  cleanup.sh clean [--gh] [--stale-days <n>] [--base <ref>] [--noise <regex>] \
                   [--scratch <regex>] [--apply] \
                   (--branch <name> [--branch <name> ...] | --branches-file <path>)

Audit is read-only except for optional fetch/prune. Clean defaults to a dry run.

  --fetch          git fetch --prune the base remote first.
  --gh             Query GitHub PR state (needs `gh`). Enables the
                   candidate-pr-* classifications. Recent PRs are prefetched in
                   one call; only branches missing from it are looked up singly.
  --stale-days n   Treat a clean branch whose last commit is older than n days
                   and which has no unpushed commits as candidate-stale.
  --noise regex    Untracked paths matching this regex do not count as dirty
                   (default: node_modules|\.goal-tracing/). They are removed
                   together with the worktree.
  --scratch regex  Untracked paths that are disposable local scratch (default:
                   probe tests, screenshots, PR body drafts, .records*). Like
                   noise they do not count as dirty and are removed with --force.
  --branches-file  Read target branches from a file, one per line.

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
scratch_regex='\.probe\.test\.tsx?$|\.png$|(^|/)pr-body[^/]*\.md$|(^|/)\.records[^/]*'
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
    --branches-file)
      (($# >= 2)) || die '--branches-file requires a path'
      [[ -r "$2" ]] || die "cannot read branches file: $2"
      while IFS= read -r line || [[ -n "$line" ]]; do
        [[ -n "$line" ]] && branches+=("$line")
      done < "$2"
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
    --scratch)
      (($# >= 2)) || die '--scratch requires a regex'
      scratch_regex=$2
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

pr_cache=''
if $use_gh; then
  command -v gh >/dev/null 2>&1 || die '--gh requires the gh CLI'
  # One bulk call instead of one per branch. Newest PR first, so the first
  # match for a head branch is its latest PR.
  pr_cache=$(mktemp)
  trap 'rm -f "$pr_cache"' EXIT
  gh pr list --state all --limit 3000 \
    --json number,state,headRefName,headRefOid,mergedAt \
    --jq '.[] | "\(.headRefName)\t\(.number)\t\(.state)\t\(.headRefOid)\t\(.mergedAt // "-")"' \
    > "$pr_cache" 2>/dev/null || : > "$pr_cache"
fi

now_epoch=$(date +%s)
# The main worktree holds the repository itself and cannot be removed.
main_worktree=$(cd "$common_dir/.." && pwd -P)

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

# A process whose cwd is inside the worktree means another session may be
# working there, whatever its Git state says.
worktree_in_use() {
  command -v lsof >/dev/null 2>&1 || return 1
  local path
  path=$(cd "$1" && pwd -P)
  lsof -d cwd -Fn 2>/dev/null | awk -v p="$path" '
    substr($0, 1, 1) == "n" { d = substr($0, 2); if (d == p || index(d, p "/") == 1) { found = 1; exit } }
    END { exit !found }
  '
}

worktree_is_usable() {
  local path=$1
  [[ -d "$path" ]] && git -C "$path" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

# Splits `git status` into real dirt and disposable entries (safe to drop with
# --force): untracked noise or scratch, and tracked files whose content equals
# the base (stale residue of a branch that is merely behind). Prints
# "<dirty> <disposable>".
dirt_counts() {
  local path=$1 dirty=0 disposable=0 line file
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    file=${line:3}
    if [[ "$line" == '?? '* ]]; then
      if [[ "$file" =~ $noise_regex || "$file" =~ $scratch_regex ]]; then
        disposable=$((disposable + 1))
      else
        dirty=$((dirty + 1))
      fi
    elif [[ "$file" != *' -> '* ]] && git -C "$path" diff --quiet "$base_ref" -- "$file" 2>/dev/null; then
      disposable=$((disposable + 1))
    else
      dirty=$((dirty + 1))
    fi
  done < <(git -C "$path" status --porcelain --untracked-files=normal)
  printf '%s %s\n' "$dirty" "$disposable"
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

# Emits: number <TAB> state <TAB> tip_eq_head <TAB> after_merge — or dashes
# without --gh. tip_eq_head is eq|ne. after_merge counts commits on the branch
# but not the base that are newer than mergedAt: a squash merge leaves the
# branch's own pre-merge commits off the base, so only these can be unmerged
# work. Computed from local objects only (the PR head may not be fetched).
pr_info() {
  local branch=$1
  if ! $use_gh; then
    printf -- '-\t-\t-\t-\n'
    return
  fi
  local raw number state head merged_at
  raw=$(awk -F'\t' -v b="$branch" '$1 == b { print $2 "\t" $3 "\t" $4 "\t" $5; exit }' "$pr_cache")
  if [[ -z "$raw" ]]; then
    raw=$(gh pr list --state all --head "$branch" --limit 1 \
      --json number,state,headRefOid,mergedAt \
      --jq '.[0] | "\(.number)\t\(.state)\t\(.headRefOid)\t\(.mergedAt // "-")"' 2>/dev/null || true)
  fi
  if [[ -z "$raw" || "$raw" == null* ]]; then
    printf -- '-\t-\t-\t-\n'
    return
  fi
  IFS=$'\t' read -r number state head merged_at <<<"$raw"
  if [[ "$(git rev-parse "$branch")" == "$head" ]]; then
    printf '%s\t%s\teq\t0\n' "$number" "$state"
    return
  fi
  local after=-
  if [[ "$state" == MERGED && "$merged_at" != - ]]; then
    local merged_epoch
    merged_epoch=$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$merged_at" +%s 2>/dev/null \
      || date -u -d "$merged_at" +%s)
    after=$(git log --format=%ct "$branch" --not "$base_ref" | awk -v m="$merged_epoch" '$1 > m' | wc -l | tr -d ' ')
  fi
  printf '%s\t%s\tne\t%s\n' "$number" "$state" "$after"
}

is_protected_branch() {
  local branch=$1
  local base_short=${base_ref#*/}
  [[ "$branch" == main || "$branch" == canary || "$branch" == "$base_ref" || "$branch" == "$base_short" ]]
}

# classify <branch> <worktree> <dirty> <age> <unpushed> <pr_state> <tip_eq> <after_merge>
classify() {
  local branch=$1 worktree=${2:-} dirty=${3:-0} age=${4:-0} unpushed=${5:-0}
  local pr_state=${6:--} tip_eq=${7:--} after=${8:--}
  local track
  track=$(upstream_track "$branch")

  if is_protected_branch "$branch"; then
    printf 'protected-branch'
  elif [[ -n "$worktree" && "$(cd "$worktree" && pwd -P)" == "$(pwd -P)" ]]; then
    printf 'protect-current'
  elif [[ -n "$worktree" && "$(cd "$worktree" && pwd -P)" == "$main_worktree" ]]; then
    printf 'protect-main'
  elif ((dirty > 0)) && [[ "$pr_state" == MERGED || "$pr_state" == CLOSED ]]; then
    # Owner policy allows discarding these, but the edits are unrecoverable:
    # list the files and get the user to name the branch.
    printf 'review-pr-done-dirty'
  elif ((dirty > 0)); then
    printf 'protect-dirty'
  elif is_merged "$branch"; then
    printf 'candidate-merged'
  elif [[ "$pr_state" == MERGED && "$tip_eq" == eq ]]; then
    printf 'candidate-pr-merged'
  elif [[ "$pr_state" == MERGED && "$after" == 0 ]]; then
    # Tip differs from the PR head but has nothing newer than the merge: pure
    # pre-merge history that the squash commit already carries.
    printf 'candidate-pr-merged-history'
  elif [[ "$pr_state" == MERGED && "$unpushed" == 0 ]]; then
    # Post-merge commits exist but a remote ref keeps them all.
    printf 'candidate-pr-merged-pushed'
  elif [[ "$pr_state" == MERGED ]]; then
    # Local-only commits newer than the merge: possibly unmerged work.
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
  printf 'scope\tpath\tbranch\tdirty\tnoise\tage_days\tunpushed\tupstream\ttrack\tmerged_into_base\tpr\tpr_state\ttip_eq_pr\tafter_merge\tclassification\n'
}

print_row() {
  local scope=$1 path=$2 branch=$3
  local dirty noise age unpushed upstream track merged pr_number pr_state tip_eq after classification
  local worktree=''
  # A concurrent cleanup may delete the branch after it was enumerated.
  git show-ref --verify --quiet "refs/heads/$branch" || return 0
  [[ "$scope" == worktree ]] && worktree=$path
  dirty=0; noise=0
  if [[ -n "$worktree" ]]; then
    read -r dirty noise < <(dirt_counts "$worktree")
  fi
  age=$(age_days "$branch")
  unpushed=$(unpushed_count "$branch")
  upstream=$(upstream_name "$branch")
  track=$(upstream_track "$branch")
  if is_merged "$branch"; then merged=yes; else merged=no; fi
  IFS=$'\t' read -r pr_number pr_state tip_eq after < <(pr_info "$branch") || true
  classification=$(classify "$branch" "$worktree" "$dirty" "$age" "$unpushed" "$pr_state" "$tip_eq" "$after")
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$scope" "$path" "$branch" "$dirty" "$noise" "$age" "$unpushed" \
    "${upstream:-none}" "${track:-none}" "$merged" "$pr_number" "$pr_state" "$tip_eq" "$after" "$classification"
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
      printf 'worktree\t%s\t%s\t?\t?\t-\t-\t-\t-\t-\t-\t-\t-\t-\tbroken-registration(%s; %s)\n' \
        "$worktree" "${branch:--}" "$present" "$reason"
      [[ -n "$branch" ]] && printf '%s\n' "$branch" >> "$bound_file"
      continue
    fi
    if [[ -z "$branch" ]]; then
      local head dirty noise
      head=$(git -C "$worktree" rev-parse --short HEAD)
      read -r dirty noise < <(dirt_counts "$worktree")
      printf 'worktree\t%s\t(detached %s)\t%s\t%s\t-\t-\t-\t-\t-\t-\t-\t-\t-\treview-detached\n' \
        "$worktree" "$head" "$dirty" "$noise"
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

  local branch worktree dirty noise age unpushed pr_number pr_state tip_eq after classification
  for branch in "${branches[@]}"; do
    if ! git show-ref --verify --quiet "refs/heads/$branch"; then
      printf 'MISSING\t%s\n' "$branch" >&2
      continue
    fi
    worktree=$(branch_worktree "$branch")
    dirty=0; noise=0
    if [[ -n "$worktree" ]]; then
      if ! worktree_is_usable "$worktree"; then
        printf 'REFUSED\t%s\tbroken-registration %s (git worktree prune, then inspect the directory)\n' "$branch" "$worktree" >&2
        continue
      fi
      read -r dirty noise < <(dirt_counts "$worktree")
    fi
    age=$(age_days "$branch")
    unpushed=$(unpushed_count "$branch")
    IFS=$'\t' read -r pr_number pr_state tip_eq after < <(pr_info "$branch") || true
    classification=$(classify "$branch" "$worktree" "$dirty" "$age" "$unpushed" "$pr_state" "$tip_eq" "$after")

    case "$classification" in
      candidate-*) ;;
      *)
        # Skip rather than abort, so one refused target does not strand the
        # rest of a long batch.
        printf 'REFUSED\t%s\t%s\n' "$branch" "$classification" >&2
        continue
        ;;
    esac

    if [[ -n "$worktree" ]] && worktree_in_use "$worktree"; then
      printf 'REFUSED\t%s\tin-use (a process has its cwd in %s)\n' "$branch" "$worktree" >&2
      continue
    fi

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
