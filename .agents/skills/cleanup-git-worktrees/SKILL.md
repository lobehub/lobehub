---
name: cleanup-git-worktrees
description: 'Use for stale-worktree, Git registration and branch audits. Managed removal uses the repo lifecycle.'
---

# Cleanup Git Worktrees

Use the bundled script to make classification deterministic. Treat cleanup as a destructive action: audit first, show the exact candidates grouped by why they are deletable, and obtain one explicit approval before applying deletion unless the user's current request already names the exact targets. Aim for a single approval round-trip, not a per-item Q\&A.

## Workflow

1. Run the audit from any worktree in the repository:

   ```bash
   bash .agents/skills/cleanup-git-worktrees/scripts/cleanup.sh audit --fetch --gh --stale-days 15 --base origin/canary
   ```

   - `--fetch`: prune the remote first. Omit only when offline and say so.
   - `--gh`: look up each branch's PR (number, state, head SHA) with the `gh` CLI. This is what turns `[gone]` into a verified merge; use it whenever `gh` is authenticated. It costs roughly one second per branch, so run it in the background on large repos.
   - `--stale-days N`: mark clean branches idle longer than N days with nothing unpushed as `candidate-stale`. The repository default the user has approved is 15 days.
   - `--noise REGEX`: untracked paths that never count as dirt (default `node_modules|\.goal-tracing/`).

2. Interpret classifications:

   | Classification             | Meaning                                                           | Action                                     |
   | -------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
   | `protected-branch`         | `main`, `canary`, or the base ref                                 | never                                      |
   | `protect-current`          | the worktree running the command                                  | never                                      |
   | `protect-dirty`            | tracked modifications, or untracked files outside the noise regex | keep; list the files                       |
   | `candidate-merged`         | tip is an ancestor of the base                                    | delete                                     |
   | `candidate-pr-merged`      | PR state MERGED and local tip == PR head SHA                      | delete                                     |
   | `candidate-pr-closed`      | PR CLOSED and tip == PR head or nothing unpushed                  | delete                                     |
   | `candidate-gone`           | upstream pruned and nothing unpushed                              | delete after confirming PR state           |
   | `candidate-stale`          | older than `--stale-days`, clean, nothing unpushed                | delete                                     |
   | `review-pr-merged-ahead`   | PR merged but local tip has extra commits                         | check the extra commits by subject (below) |
   | `review-gone-unpushed`     | upstream pruned but local-only commits exist                      | keep; deleting loses work                  |
   | `review-no-upstream`       | no upstream, not merged                                           | keep unless the user names it              |
   | `review-detached`          | detached HEAD worktree                                            | keep; show its dirty files                 |
   | `broken-registration(...)` | registration whose gitdir is gone                                 | see below                                  |
   | `active`                   | everything else                                                   | keep                                       |

   Columns worth reading: `dirty` (real dirt), `noise` (ignorable untracked), `age_days`, `unpushed` (commits no remote ref reaches), `pr` / `pr_state` / `tip_eq_pr`.

3. Present one compact table split into three groups: deletable now (all `candidate-*`), needs a manual check (`review-*`), and protected. Keep `candidate-merged` separate from `candidate-gone`, and never describe `[gone]` alone as proof of merge.

4. After approval, use the repository's worktree lifecycle workflow when it manages services or other resources alongside a checkout; the Git-only script does not tear those down. For plain Git worktrees, pass exact branch names and the same classification flags used for the audit:

   ```bash
   bash .agents/skills/cleanup-git-worktrees/scripts/cleanup.sh clean \
     --gh --stale-days 15 --base origin/canary \
     --branch feat/example \
     --branch fix/example \
     --apply
   ```

   Without `--apply`, cleanup is a dry run. The script re-classifies every target immediately before deletion and refuses anything that is not `candidate-*`. Worktrees whose only dirt is noise are removed with `git worktree remove --force`; everything else uses the plain, refusing form.

   Removing a worktree that still holds `node_modules` can take several minutes each. Run large batches in the background and report progress rather than waiting on a single foreground call.

5. Run the audit again and report:

   - removed worktrees and branches, with the SHA each branch pointed at (the script prints it; reflog keeps it for 90 days);
   - retained dirty / unpushed / detached targets and why;
   - remaining worktree and local-branch counts;
   - any partial deletion or Git error.

## Proving a merge

Squash and rebase merges leave no ancestry, so `git merge-base --is-ancestor` and `git cherry` say "not merged" for branches whose PR landed. Use this ladder instead:

1. `--gh` reports `pr_state=MERGED` and `tip_eq_pr=eq`: the local tip is exactly what GitHub merged. Done.
2. `review-pr-merged-ahead` (tip moved past the PR head): list the extra commits with `git log <pr-head>..<branch>` and search the base for each subject: `git log origin/canary --oneline -F --grep="<subject>"`. A hit on the PR's squash commit means the commit was part of the PR. A miss means the commit is unmerged; check which live branch still contains it with `git branch --contains <sha>` before deleting.
3. Branches named after a PR (`pr-18412`, `codex/pr-18497-fix`) are local review copies; verify the PR by number with `gh pr view N --json state,headRefOid` and compare subjects as above.
4. Do not judge by `git diff origin/canary <branch> -- <files>`: on an old branch the diff is dominated by later changes on the base.

Zero `unpushed` means every local commit is reachable from some remote ref, so deleting the local branch loses nothing even when the PR is still OPEN; the user has approved deleting such branches once they pass the stale threshold.

## Repo-approved deletion policy

The repository owner has approved the following for this repo, so a cleanup run does not need to re-ask per item. It is the sanctioned exception to the safety rules below; state it in the report and say plainly whenever uncommitted work is being discarded.

- **Dirt equal to the base is not dirt.** A tracked file listed as modified whose content is byte-identical to the base (`git diff --quiet <base> -- <file>`) is stale residue of a branch that is simply behind. When presenting, do not count it as a real change: list such files in their own group so the genuine modifications stay visible.
- **Merged / closed PR branches are disposable together with their local commits.** When a branch's PR is `MERGED` or `CLOSED`, its worktree and local branch may be removed even when `unpushed > 0` or the tree is dirty. Record every branch SHA before deleting (reflog keeps them \~90 days) and state in the report that uncommitted edits are not recoverable.
- **Local scratch does not block removal.** Untracked `*.probe.test.ts`, spike scripts under `scripts/`, and untracked screenshots (`*.png`) are disposable; do not raise them as blockers.
- Still never delete: `main`, `canary`, the base ref, and the worktree running the command. A branch whose PR is **OPEN** is kept while it still holds local-only work (dirty files or `unpushed > 0`); a clean, fully-pushed branch with an open PR is the redundant local copy the stale rule already covers.

**Proving a merge when the repo squash-merges.** This repo squash-merges, so a landed PR leaves the squash commit on the base but none of the branch's own commits. Searching the base for an individual commit subject therefore fails for every squashed branch — do not read that as "unmerged". Decide `review-pr-merged-ahead` by the PR's state plus commit dates instead: if the branch tip is not newer than `mergedAt`, the branch is pure pre-merge history whose content is already on the base (verify the PR's `mergeCommit` with `git merge-base --is-ancestor <mergeCommit> origin/canary`). Only commits dated after `mergedAt` are candidate unmerged work — keep the branch and list them.

The bundled script still refuses anything outside `candidate-*`, so these removals are done manually: `wt_path=$(git worktree list --porcelain …)` → record `git rev-parse <branch>` → `git worktree remove --force` → `git branch -D`. Keep the run in the background; removals that hold `node_modules` take minutes each.

## Broken registrations

`git worktree list --porcelain` marks an entry `prunable` when its gitdir file points nowhere (typically after a partial removal). The audit reports these as `broken-registration(directory-present|missing; reason)` instead of crashing on them.

- `git worktree prune` drops only the registration. It never touches the directory or the branch, so it is safe to run before re-auditing.
- A leftover directory has no `.git`, so its dirty state cannot be checked. Show its size and file count and ask before deleting it with `rm -rf`; that is the one place recursive deletion is acceptable, and only on a path the user named.

## Safety rules

- Never discard dirty worktrees merely because their branch is merged, `[gone]`, or old; noise-only dirt (the `--noise` regex) does not count. The one exception is a worktree whose branch's PR is `MERGED` or `CLOSED`, per the repo-approved deletion policy above.
- Never delete a branch with `unpushed > 0` through this script; list it and let the user decide. Same exception: a `MERGED`/`CLOSED` PR branch may be removed under the owner's standing approval, with its SHA recorded first.
- Never use recursive deletion on a registered worktree. If Git partially removes a directory, stop and inspect the exact path before deciding how to recover.
- Never delete `main`, `canary`, or the base branch.
- Preserve unrelated user changes and concurrent worktrees. The user's other sessions may be working in them.
- When writing ad-hoc verification loops, run them under `bash`, not the interactive `zsh`: zsh does not word-split `$var` in `for`/argument positions, so file lists collapse into one argument and checks silently pass.

## Script

Use `scripts/cleanup.sh`; do not recreate its parsing and guard logic ad hoc unless the repository layout makes it unusable. It is `set -euo pipefail`; helper functions that pipe through `grep` wrap it in `|| true` so an empty match is "clean", not an abort.
