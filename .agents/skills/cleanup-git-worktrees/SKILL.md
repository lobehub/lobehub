---
name: cleanup-git-worktrees
description: 'Use for stale-worktree, Git registration and branch audits. Managed removal uses the repo lifecycle.'
---

# Cleanup Git Worktrees

Use the bundled script to make classification deterministic. Treat cleanup as a destructive action: audit first, show the exact candidates grouped by why they are deletable, and obtain one explicit approval before applying deletion unless the user's current request explicitly authorizes deleting those exact targets. Naming a branch for inspection is not deletion authorization. Explain that `clean` deletes both worktrees and local branches, including ignored build artifacts matching the noise policy; remote branches and PRs are unchanged. If only worktree removal was authorized, preserve local branches instead of using `clean`. Aim for a single approval round-trip, not a per-item Q\&A.

## Workflow

1. Run the audit from any worktree in the repository:

   ```bash
   bash .agents/skills/cleanup-git-worktrees/scripts/cleanup.sh audit --fetch --gh --stale-days 15 --base origin/canary
   ```

   - `--fetch`: prune the remote first. Omit only when offline and say so.
   - `--gh`: query the configured GitHub remote explicitly. Only a single PR with matching head repository and base branch is used as evidence. Multiple PRs, fork heads, missing repository identity, or another base require manual review unless direct ancestry already proves the merge. Lookup failures stop the operation, never masquerade as “no PR”.
   - `--base`: an existing remote-tracking ref, such as `origin/canary`; local base branches are not supported.
   - `--stale-days N`: mark clean branches whose last commit is older than N days and whose commits have remote-ref coverage as `candidate-stale`. The suggested threshold is 15 days, not prior authorization to delete, and commit age is not last-use time.
   - `--noise REGEX`: untracked/ignored paths excluded from dirty counts (default `(^|/)(node_modules|\.goal-tracing)(/|$)`). Matching uses complete directory components by default. Other ignored files, including `.env`, count as dirty. Inspect noise paths before approval; changing this regex broadens what may be discarded.

2. Interpret classifications:

   | Classification               | Meaning                                                                   | Action                                             |
   | ---------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
   | `protected-branch`           | `main`, `canary`, or the base ref                                         | never                                              |
   | `protect-current`            | the worktree running the command                                          | never                                              |
   | `protect-dirty`              | tracked modifications, or untracked/ignored files outside the noise regex | keep; list the files                               |
   | `candidate-merged`           | tip is an ancestor of the base                                            | delete                                             |
   | `candidate-pr-merged`        | PR state MERGED and local tip == PR head SHA                              | delete                                             |
   | `candidate-pr-closed`        | PR CLOSED and tip == PR head or nothing unpushed                          | delete                                             |
   | `candidate-gone`             | upstream pruned and nothing unpushed                                      | delete after confirming PR state                   |
   | `candidate-stale`            | older than `--stale-days`, clean, nothing unpushed                        | delete                                             |
   | `review-pr-merged-different` | PR merged but local tip differs from PR head                              | verify ancestry and content; keep by default       |
   | `review-pr-ambiguous`        | PR identity or base does not match, or multiple PRs found                 | resolve manually; script refuses cleanup           |
   | `review-gone-unpushed`       | upstream pruned but commits lack current remote-ref coverage              | keep; investigate delivery                         |
   | `review-no-upstream`         | no upstream, not merged                                                   | keep; naming the branch does not bypass the script |
   | `review-detached`            | detached HEAD worktree                                                    | keep; show its dirty files                         |
   | `broken-registration(...)`   | registration whose gitdir is gone                                         | see below                                          |
   | `active`                     | everything else                                                           | keep                                               |

   Columns worth reading: `dirty` (real dirt), `noise` (ignorable untracked), `age_days`, `unpushed` (commits no remote ref reaches), `pr` / `pr_state` / `tip_eq_pr`.

3. Present one compact table split into three groups: deletion candidates (`candidate-*`, still subject to approval and final checks), needs a manual check (`review-*`), and protected. Keep `candidate-merged` separate from `candidate-gone`, and never describe `[gone]` alone as proof of merge.

4. After approval, use the repository's worktree lifecycle workflow when it manages services or other resources alongside a checkout; the Git-only script does not tear those down. For plain Git worktrees, pass exact branch names and the same classification flags used for the audit:

   ```bash
   bash .agents/skills/cleanup-git-worktrees/scripts/cleanup.sh clean \
     --gh --stale-days 15 --base origin/canary \
     --branch feat/example \
     --branch fix/example \
     --apply
   ```

   Without `--apply`, cleanup is a dry run. The script re-classifies every target, then checks refs, registration and status again after network lookups. It refuses non-candidates and never uses `worktree remove --force`. Untracked noise can therefore block removal: inspect and remove it separately with approval rather than escalating to force. Ignored noise can be removed by ordinary Git worktree removal. It records the full inspected SHA before removal, uses compare-and-delete for the branch ref, and reports success only after each operation succeeds.

   Do not clean a worktree used by an active agent, editor or service. These checks are not an atomic lock against other processes: ignored files or checkout state can still change between checks and removal. Stop coordinated writers first; if exclusive access cannot be established, retain the target. A batch may partially succeed; inspect the log and remaining registration before retrying.

   Any registered worktree with a paused rebase/bisect blocks all cleanup, including dry runs: detached HEAD can still own a branch. Finish or abort the operation separately; do not clear state files to bypass protection. Broken registrations also block cleanup until they can be inspected or resolved. Audit remains available for inventory.

   Removing a worktree that still holds `node_modules` can take several minutes each. Run large batches in the background and report progress rather than waiting on a single foreground call.

5. Run the audit again and report:

   - removed worktrees and branches, with their full original SHAs. Branch deletion can delete its reflog; neither a 90-day recovery window nor object retention is guaranteed. If recoverability is required, create an approved backup ref or bundle before deletion; a logged SHA alone is not a backup;
   - retained dirty / unpushed / detached targets and why;
   - remaining worktree and local-branch counts;
   - any partial deletion or Git error.

## Proving a merge

Squash and rebase merges can break ancestry with original commits. `git cherry` can find equivalent individual patches, but is not a complete squash-merge detector. Use this ladder:

1. `--gh` reports `pr_state=MERGED` and `tip_eq_pr=eq`: the local tip is exactly what GitHub merged. Done.
2. `review-pr-merged-different`: first determine whether the tip is ahead, behind or divergent using ancestry checks. Inspect any uncovered commits and actual patches. Subject searches are navigation aids only: neither a match nor a miss proves delivery. If content cannot be verified, retain the branch or obtain explicit authorization to discard unverified work; the script will still refuse this review classification.
3. Branches named after a PR (`pr-18412`, `codex/pr-18497-fix`) may be local review copies; verify the PR by number, repository, base and head rather than assuming its identity from the branch name.
4. Do not judge by `git diff origin/canary <branch> -- <files>`: on an old branch the diff is dominated by later changes on the base.

### Interpreting `unpushed`

The script computes `unpushed` with `git rev-list --count <branch> --not --remotes=<remote>` (normally `origin`). It counts commits not reachable from that remote's locally fetched branch refs, not commits proven never to have been pushed. Fetch before interpreting it.

- `unpushed == 0`: every commit is covered by a fetched remote branch ref. This does not prove a merge or authorize deletion; an OPEN PR may still qualify as `candidate-stale`, subject to approval.
- `unpushed > 0`: commits lack that reference coverage. They may be genuinely local-only, or may have been delivered through a squash/rebase merge whose original remote branch was deleted. Inspect the classification and PR evidence rather than treating the count as an unconditional veto.

After the protected/current/dirty checks, the script permits these candidates regardless of `unpushed`:

| Classification        | Required evidence                                  | Approval meaning                                                                          |
| --------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `candidate-merged`    | Local tip is an ancestor of the configured base    | Remove work already in the base                                                           |
| `candidate-pr-merged` | PR is MERGED and local tip exactly equals its head | Remove work delivered through that PR, even if original commits lack remote-ref coverage  |
| `candidate-pr-closed` | PR is CLOSED and local tip exactly equals its head | Explicitly approve discarding the closed, unmerged work; closure is not proof of delivery |

`candidate-pr-closed` also permits a different local tip when `unpushed == 0`. The gone/stale candidates require `unpushed == 0`. Otherwise retain the branch for review; `clean` refuses non-candidate classifications even if a branch was explicitly named.

## Broken registrations

`git worktree list --porcelain` marks an entry `prunable` when its gitdir file points nowhere (typically after a partial removal). The audit reports these as `broken-registration(directory-present|missing; reason)` instead of crashing on them.

- `git worktree prune` drops only the registration. It never touches the directory or the branch, so it is safe to run before re-auditing.
- A leftover directory has no `.git`, so its dirty state cannot be checked. Show its size and file count and ask before deleting it with `rm -rf`; that is the one place recursive deletion is acceptable, and only on a path the user named.

## Safety rules

- Never discard dirty worktrees merely because their branch is merged, `[gone]`, or old. Noise-only dirt (the `--noise` regex) does not count.
- Do not delete solely based on `unpushed`. For `unpushed > 0`, require one of the candidate exceptions documented above and explicit approval; otherwise retain and report the uncovered commits. Closed, unmerged PR work requires approval to discard, not an assumption that it was merged.
- Never use recursive deletion on a registered worktree. If Git partially removes a directory, stop and inspect the exact path before deciding how to recover.
- Never delete `main`, `canary`, or the base branch.
- Preserve unrelated user changes and concurrent worktrees. The user's other sessions may be working in them.
- When writing ad-hoc verification loops, run them under `bash`, not the interactive `zsh`: zsh does not word-split `$var` in `for`/argument positions, so file lists collapse into one argument and checks silently pass.

## Script

Use `scripts/cleanup.sh`; do not recreate its parsing and guard logic ad hoc unless the repository layout makes it unusable. Status is read once per check using NUL-delimited porcelain with explicit untracked, ignored and submodule settings. Status and PR failures stop the operation.

Run the isolated regression suite with `python3 .agents/skills/cleanup-git-worktrees/scripts/cleanup_test.py`. It creates disposable repositories and mocks GitHub responses; never test destructive paths against real worktrees.
