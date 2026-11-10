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
   - `--gh`: look up each branch's PR (number, state, head SHA, `mergedAt`) with the `gh` CLI. This is what turns `[gone]` into a verified merge; use it whenever `gh` is authenticated. The script prefetches the latest 3000 PRs in one call and only queries older branches one by one; a full audit of ~300 entries still takes minutes, so run it in the background.
   - `--stale-days N`: mark clean branches idle longer than N days with nothing unpushed as `candidate-stale`. The repository default the user has approved is 15 days.
   - `--noise REGEX`: untracked paths that never count as dirt (default `node_modules|\.goal-tracing/`).
   - `--scratch REGEX`: untracked local scratch that never counts as dirt (default: `*.probe.test.ts(x)`, `*.png`, `pr-body*.md`, `.records*`). Tracked files whose content equals the base are also not dirt. All three count in the `noise` column and are removed with `--force`.

2. Interpret classifications:

   | Classification                | Meaning                                                                        | Action                                 |
   | ----------------------------- | ------------------------------------------------------------------------------ | -------------------------------------- |
   | `protected-branch`            | `main`, `canary`, or the base ref                                              | never                                  |
   | `protect-current`             | the worktree running the command                                               | never                                  |
   | `protect-main`                | the repository's main worktree                                                 | never                                  |
   | `review-pr-done-dirty`        | PR MERGED/CLOSED but the tree has real (non-scratch) edits                     | list the files; delete only when named |
   | `protect-dirty`               | real dirt and no merged/closed PR                                              | keep; list the files                   |
   | `candidate-merged`            | tip is an ancestor of the base                                                 | delete                                 |
   | `candidate-pr-merged`         | PR state MERGED and local tip == PR head SHA                                   | delete                                 |
   | `candidate-pr-merged-history` | PR MERGED; tip != PR head, but no commit off the base is newer than `mergedAt` | delete                                 |
   | `candidate-pr-merged-pushed`  | PR MERGED; post-merge commits exist but all are on a remote ref                | delete; mention unlanded commits       |
   | `candidate-pr-closed`         | PR CLOSED and tip == PR head or nothing unpushed                               | delete                                 |
   | `candidate-gone`              | upstream pruned and nothing unpushed                                           | delete after confirming PR state       |
   | `candidate-stale`             | older than `--stale-days`, clean, nothing unpushed                             | delete                                 |
   | `review-pr-merged-ahead`      | PR merged; local-only commits newer than `mergedAt`                            | inspect those commits (below)          |
   | `review-gone-unpushed`        | upstream pruned but local-only commits exist                                   | keep; deleting loses work              |
   | `review-no-upstream`          | no upstream, not merged                                                        | keep unless the user names it          |
   | `review-detached`             | detached HEAD worktree                                                         | keep; show its dirty files             |
   | `broken-registration(...)`    | registration whose gitdir is gone                                              | see below                              |
   | `active`                      | everything else                                                                | keep                                   |

   Columns worth reading: `dirty` (real dirt), `noise` (disposable: noise, scratch, base-equal files), `age_days`, `unpushed` (commits no remote ref reaches), `pr` / `pr_state` / `tip_eq_pr`, `after_merge` (commits on the branch but not the base that are newer than `mergedAt`).

3. Present one compact table split into three groups: deletable now (all `candidate-*`), needs a manual check (`review-*`), and protected. Keep `candidate-merged` separate from `candidate-gone`, and never describe `[gone]` alone as proof of merge.

4. After approval, use the repository's worktree lifecycle workflow when it manages services or other resources alongside a checkout; the Git-only script does not tear those down. For plain Git worktrees, pass exact branch names and the same classification flags used for the audit:

   ```bash
   bash .agents/skills/cleanup-git-worktrees/scripts/cleanup.sh clean \
     --gh --stale-days 15 --base origin/canary \
     --branch feat/example \
     --branch fix/example \
     --apply
   ```

   For a batch, write the branch names one per line and pass `--branches-file <path>`. Do not build `--branch` lists in a shell variable: the interactive shell is zsh, which passes an unquoted `$args` as one argument.

   Without `--apply`, cleanup is a dry run. The script re-classifies every target immediately before deletion. It skips, with a `REFUSED` line on stderr, anything that is not `candidate-*` and any worktree a live process uses as its cwd (another session may be working there); the rest of the batch continues. Worktrees whose only dirt is disposable are removed with `git worktree remove --force`; everything else uses the plain, refusing form.

   Removing a worktree that still holds `node_modules` takes one to two minutes each, so a batch of 100 runs for hours, longer than a background task's time limit. A time limit kills the run mid-removal and leaves a half-deleted directory. Launch large batches detached and poll the log:

   ```bash
   nohup bash .agents/skills/cleanup-git-worktrees/scripts/cleanup.sh clean \
     --gh --stale-days 15 --base origin/canary --branches-file /tmp/<unique>-targets.txt --apply \
     > /tmp/<unique>-clean.log 2>&1 < /dev/null & disown
   ```

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
- **Local scratch does not block removal.** Untracked `*.probe.test.ts`, screenshots (`*.png`), PR body drafts (`pr-body*.md`) and `.records*` evidence are disposable (the `--scratch` default). Untracked spike scripts under `scripts/` are too, but they stay out of the default regex because `scripts/` also holds real new files; judge them by hand.
- Still never delete: `main`, `canary`, the base ref, and the worktree running the command. A branch whose PR is **OPEN** is kept while it still holds local-only work (dirty files or `unpushed > 0`); a clean, fully-pushed branch with an open PR is the redundant local copy the stale rule already covers.

**Proving a merge when the repo squash-merges.** This repo squash-merges, so a landed PR leaves the squash commit on the base but none of the branch's own commits. Searching the base for an individual commit subject therefore fails for every squashed branch; do not read that as "unmerged". The script decides by commit dates instead: commits off the base that are not newer than `mergedAt` are pre-merge history the squash already carries (`candidate-pr-merged-history`). Post-merge commits that a remote ref still holds lose nothing locally (`candidate-pr-merged-pushed`), but say in the report that they never reached the base.

`review-pr-merged-ahead` is left for local-only commits newer than the merge. List them with `git log --format='%h %cI %s' <branch> --not origin/canary --remotes=origin` and judge each:

- a follow-up that landed through a later PR shows up on the base under the same subject plus `(#N)`: `git log origin/canary --oneline -F --grep="<subject>"`. Disposable.
- a follow-up nobody opened a PR for, made obsolete by later work on the base, is disposable under the policy above.
- anything still relevant is kept and reported.

The bundled script refuses `review-*`, so removals the user approves for those are done manually: `wt_path=$(git worktree list --porcelain …)` → check no process has its cwd there (`lsof -d cwd`) → record `git rev-parse <branch>` → `git worktree remove --force` → `git branch -D`. Run them detached the same way.

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
- The repo is a partial clone. Probing an object that is not local (an old PR head via `git cat-file`, `git log <pr-head>..`) silently fetches it from the remote, which turns a loop over 30 branches into tens of minutes. Export `GIT_NO_LAZY_FETCH=1` in ad-hoc loops, as the script does.
- When writing ad-hoc verification loops, run them under `bash`, not the interactive `zsh`: zsh does not word-split `$var` in `for`/argument positions, so file lists collapse into one argument and checks silently pass.

## Script

Use `scripts/cleanup.sh`; do not recreate its parsing and guard logic ad hoc unless the repository layout makes it unusable. It is `set -euo pipefail`; helper functions that pipe through `grep` wrap it in `|| true` so an empty match is "clean", not an abort.
