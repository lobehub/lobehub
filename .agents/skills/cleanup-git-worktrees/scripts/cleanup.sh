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
                   (default: complete node_modules or .goal-tracing components).
                   Cleanup never uses --force; untracked noise must be removed first.

Pass the same --gh / --stale-days / --noise flags to clean that you used for
audit, otherwise the pre-deletion re-classification will refuse the target.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || die 'not inside a Git worktree'
repo_root=$(cd "$repo_root" && pwd -P)

command_name=${1:-}
[[ -n "$command_name" ]] || { usage; exit 2; }
shift

base_ref=origin/canary
fetch_remote=false
use_gh=false
stale_days=0
noise_regex='(^|/)(node_modules|\.goal-tracing)(/|$)'
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
  || die "base must be an existing remote-tracking ref: $base_ref"

remote=${base_ref%%/*}
[[ "$remote" != "$base_ref" ]] || remote=origin

if $fetch_remote; then
  git fetch --prune "$remote"
fi

if $use_gh; then
  command -v gh >/dev/null 2>&1 || die '--gh requires the gh CLI'
  remote_url=$(git remote get-url "$remote")
  case "$remote_url" in
    https://github.com/*) github_repo=${remote_url#https://github.com/} ;;
    git@github.com:*) github_repo=${remote_url#git@github.com:} ;;
    *) die '--gh requires a github.com remote URL' ;;
  esac
  github_repo=${github_repo%.git}
fi

if [[ '' =~ $noise_regex ]]; then
  die 'noise regex must not match an empty path'
else
  [[ $? == 1 ]] || die 'invalid noise regex'
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

# Rebase/bisect can own branches while HEAD is detached. update-ref has no
# branch porcelain ownership checks, so conservatively block all cleanup.
assert_no_operations() {
  local snapshot entry path marker state
  snapshot=$(mktemp)
  if ! git worktree list --porcelain -z > "$snapshot"; then
    rm -f "$snapshot"
    die 'cannot enumerate worktrees'
  fi
  while IFS= read -r -d '' entry; do
    [[ "$entry" == 'worktree '* ]] || continue
    path=${entry#worktree }
    if ! worktree_is_usable "$path"; then
      rm -f "$snapshot"
      die "cannot inspect operations in $path; resolve broken registration first"
    fi
    for marker in rebase-merge rebase-apply BISECT_START; do
      state=$(git -C "$path" rev-parse --path-format=absolute --git-path "$marker") || {
        rm -f "$snapshot"
        die "cannot inspect operation state in $path"
      }
      if [[ -e "$state" ]]; then
        rm -f "$snapshot"
        die "operation in progress ($marker) in $path; finish or abort it before cleanup"
      fi
    done
  done < "$snapshot"
  rm -f "$snapshot"
}

# Use one NUL-delimited snapshot, including ignored files and submodule dirt.
status_counts() {
  local snapshot entry path code dirty=0 noise=0
  snapshot=$(mktemp)
  if ! git -C "$1" status --porcelain=v1 -z --untracked-files=all --ignored=matching --ignore-submodules=none > "$snapshot"; then
    rm -f "$snapshot"
    die "cannot inspect status: $1"
  fi
  while IFS= read -r -d '' entry; do
    code=${entry:0:2}
    path=${entry:3}
    if [[ ( "$code" == '??' || "$code" == '!!' ) && "$path" =~ $noise_regex ]]; then
      noise=$((noise + 1))
    else
      dirty=$((dirty + 1))
    fi
    if [[ "$code" == *R* || "$code" == *C* ]]; then
      IFS= read -r -d '' entry || { rm -f "$snapshot"; die 'invalid rename status'; }
    fi
  done < "$snapshot"
  rm -f "$snapshot"
  printf '%s\t%s\n' "$dirty" "$noise"
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

# Commits not covered by locally fetched refs for this remote; not proof of
# never-pushed work, nor proof that deletion is authorized when zero.
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
  local raw number state head base head_repo
  raw=$(gh pr list --repo "$github_repo" --state all --head "$branch" --limit 100 \
    --json number,state,headRefOid,baseRefName,headRepository,headRepositoryOwner \
    --jq '.[] | [.number, .state, .headRefOid, .baseRefName, (.headRepositoryOwner.login + "/" + .headRepository.name)] | @tsv') \
    || die "PR lookup failed for $branch"
  if [[ -z "$raw" ]]; then
    printf -- '-\t-\t-\n'
    return
  fi
  if [[ "$raw" == *$'\n'* ]]; then
    printf -- '-\tAMBIGUOUS\t-\n'
    return
  fi
  IFS=$'\t' read -r number state head base head_repo <<<"$raw"
  [[ "$number" =~ ^[0-9]+$ && "$head" =~ ^[0-9a-f]{40,64}$ ]] || die "invalid PR response for $branch"
  case "$state" in OPEN|CLOSED|MERGED) ;; *) die "invalid PR state for $branch" ;; esac
  if [[ "$head_repo" != "$github_repo" || "$base" != "${base_ref#*/}" ]]; then
    printf -- '-\tAMBIGUOUS\t-\n'
    return
  fi
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
  elif [[ -n "$worktree" && "$(cd "$worktree" && pwd -P)" == "$repo_root" ]]; then
    printf 'protect-current'
  elif ((dirty > 0)); then
    printf 'protect-dirty'
  elif is_merged "$branch"; then
    printf 'candidate-merged'
  elif [[ "$pr_state" == AMBIGUOUS ]]; then
    printf 'review-pr-ambiguous'
  elif [[ "$pr_state" == MERGED && "$tip_eq" == eq ]]; then
    printf 'candidate-pr-merged'
  elif [[ "$pr_state" == MERGED ]]; then
    # A different tip may be ahead, behind, or divergent; do not infer delivery.
    printf 'review-pr-merged-different'
  elif [[ "$pr_state" == CLOSED && ( "$tip_eq" == eq || "$unpushed" == 0 ) ]]; then
    printf 'candidate-pr-closed'
  elif [[ "$track" == '[gone]' && "$unpushed" == 0 ]]; then
    printf 'candidate-gone'
  elif [[ "$track" == '[gone]' ]]; then
    # These commits lack remote-ref coverage; they may still have been squashed.
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
  local dirty noise age unpushed upstream track merged pr_number pr_state tip_eq classification counts pr
  local worktree=''
  [[ "$scope" == worktree ]] && worktree=$path
  dirty=0; noise=0
  if [[ -n "$worktree" ]]; then
    counts=$(status_counts "$worktree") || return 1
    IFS=$'\t' read -r dirty noise <<< "$counts"
  fi
  age=$(age_days "$branch")
  unpushed=$(unpushed_count "$branch")
  upstream=$(upstream_name "$branch")
  track=$(upstream_track "$branch")
  if is_merged "$branch"; then merged=yes; else merged=no; fi
  pr=$(pr_info "$branch") || return 1
  IFS=$'\t' read -r pr_number pr_state tip_eq <<< "$pr"
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
      local head dirty noise counts
      head=$(git -C "$worktree" rev-parse --short HEAD)
      counts=$(status_counts "$worktree") || return 1
      IFS=$'\t' read -r dirty noise <<< "$counts"
      printf 'worktree\t%s\t(detached %s)\t%s\t%s\t-\t-\t-\t-\t-\t-\t-\t-\treview-detached\n' \
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
  assert_no_operations

  local branch worktree dirty noise age unpushed pr_number pr_state tip_eq classification counts pr tip base_tip config_error config_status
  for branch in "${branches[@]}"; do
    git show-ref --verify --quiet "refs/heads/$branch" || die "local branch not found: $branch"
    tip=$(git rev-parse "refs/heads/$branch")
    base_tip=$(git rev-parse "$base_ref")
    worktree=$(branch_worktree "$branch")
    dirty=0; noise=0
    if [[ -n "$worktree" ]]; then
      worktree_is_usable "$worktree" || die "$branch: worktree $worktree is a broken registration; run 'git worktree prune' and inspect the directory first"
      counts=$(status_counts "$worktree") || return 1
      IFS=$'\t' read -r dirty noise <<< "$counts"
    fi
    age=$(age_days "$branch")
    unpushed=$(unpushed_count "$branch")
    pr=$(pr_info "$branch") || return 1
    IFS=$'\t' read -r pr_number pr_state tip_eq <<< "$pr"
    classification=$(classify "$branch" "$worktree" "$dirty" "$age" "$unpushed" "$pr_state" "$tip_eq")

    case "$classification" in
      candidate-*) ;;
      *) die "$branch is $classification; refusing cleanup" ;;
    esac

    if ! $apply; then
      printf 'DRY-RUN\t%s\t%s\t%s\tnoise=%s\n' "$branch" "${worktree:--}" "$classification" "$noise"
      continue
    fi

    [[ "$(git rev-parse "refs/heads/$branch")" == "$tip" && "$(git rev-parse "$base_ref")" == "$base_tip" ]] \
      || die "$branch: refs changed during inspection"
    [[ "$(branch_worktree "$branch")" == "$worktree" ]] || die "$branch: worktree registration changed"
    assert_no_operations
    printf 'PLANNED-REMOVAL\t%s\t%s\n' "$branch" "$tip"
    if [[ -n "$worktree" ]]; then
      [[ "$(git -C "$worktree" symbolic-ref HEAD)" == "refs/heads/$branch" ]] || die 'worktree branch changed'
      counts=$(status_counts "$worktree") || return 1
      IFS=$'\t' read -r dirty noise <<< "$counts"
      ((dirty == 0)) || die "$branch: worktree became dirty"
      # Never force: Git must reject new tracked/untracked work, including noise.
      git worktree remove "$worktree" || die "$branch: worktree removal failed; branch retained"
      printf 'REMOVED-WORKTREE\t%s\n' "$worktree"
    fi
    [[ -z "$(branch_worktree "$branch")" ]] || die "$branch: branch is checked out again"
    assert_no_operations
    # Compare-and-delete refuses a branch advanced after the inspected snapshot.
    git update-ref -d "refs/heads/$branch" "$tip" || die "$branch: branch removal failed; inspect partial cleanup"
    if config_error=$(LC_ALL=C git config --remove-section "branch.$branch" 2>&1); then
      :
    else
      config_status=$?
      # Exit 128 alone also covers other fatal errors; match the absent-section
      # diagnostic exactly in a fixed locale. Unknown errors fail closed.
      if [[ "$config_status" != 128 || "$config_error" != "fatal: no such section: branch.$branch" ]]; then
        printf '%s\n' "$config_error" >&2
        die "$branch: configuration cleanup failed; branch ref already deleted (was $tip); partial cleanup"
      fi
    fi
    printf 'REMOVED-BRANCH\t%s\t%s\t(was %s)\n' "$branch" "$classification" "$tip"
  done
}

case "$command_name" in
  audit) audit ;;
  clean) clean ;;
  *) usage; exit 2 ;;
esac
