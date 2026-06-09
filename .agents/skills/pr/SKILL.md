---
name: pr
description: "Create a PR for the current branch (targets `canary` by default), including splitting one cross-layer branch into ordered stacked PRs so a lower layer (db / shared package / server TRPC) merges before its callers (desktop / CLI / UI). Use when the user asks to create / submit a PR, or to split a branch because clients call a server contract that isn't on the trunk yet. Triggers on 'pr', 'create pr', 'submit pr', 'open a PR', 'pull request', 'split this PR', 'stacked PR', 'backend should merge first', '提 PR', '提个 PR', '新建 PR', '拆 PR', '后端先合', '分层合并'."
user-invocable: true
---

# Create Pull Request

## Branch Strategy

- **Target branch**: `canary` (development branch, cloud production)
- `main` is the release branch — never PR directly to main

## Steps

### 1. Gather context (run in parallel)

- `git branch --show-current` — current branch name
- `git status --short` — uncommitted changes
- `git rev-parse --abbrev-ref @{u} 2>/dev/null` — remote tracking status
- `git log --oneline origin/canary..HEAD` — unpushed commits
- `gh pr list --head "$(git branch --show-current)" --json number,title,state,url` — existing PR
- `git diff --stat --stat-count=20 origin/canary..HEAD` — change summary

### 2. Handle uncommitted changes on default branch

If current branch is `canary` (or `main`) AND there are uncommitted changes:

1. Analyze the diff (`git diff`) to understand the changes
2. Infer a branch name from the changes, format: `<type>/<short-description>` (e.g. `fix/i18n-cjk-spacing`)
3. Create and switch to the new branch: `git checkout -b <branch-name>`
4. Stage relevant files: `git add <files>` (prefer explicit file paths over `git add .`)
5. Commit with a proper gitmoji message
6. Continue to step 3

If current branch is `canary`/`main` but there are NO uncommitted changes and no unpushed commits, abort — nothing to create a PR for.

### 3. Push if needed

- No upstream: `git push -u origin $(git branch --show-current)`
- Has upstream: `git push origin $(git branch --show-current)`

### 4. Search related GitHub issues

- `gh issue list --search "<keywords>" --state all --limit 10`
- Only link issues with matching scope (avoid large umbrella issues)
- Skip if no matching issue found

### 5. Create PR with `gh pr create --base canary`

- Title: `<gitmoji> <type>(<scope>): <description>`
- Body: based on PR template (`.github/PULL_REQUEST_TEMPLATE.md`), fill checkboxes
- Link related GitHub issues using magic keywords (`Fixes #123`, `Closes #123`)
- Link Linear issues if applicable (`Fixes LOBE-xxx`)
- Use HEREDOC for body to preserve formatting

### 6. Open in browser

`gh pr view --web`

## PR Template

Use `.github/PULL_REQUEST_TEMPLATE.md` as the body structure. Key sections:

- **Change Type**: Check the appropriate gitmoji type
- **Related Issue**: Link GitHub/Linear issues with magic keywords
- **Description of Change**: Summarize what and why
- **How to Test**: Describe test approach, check relevant boxes

## Notes

- **Language**: All PR content must be in English
- If a PR already exists for the branch, inform the user instead of creating a duplicate

---

# Stacked PRs (cross-layer feature)

The steps above create **one** PR for the current branch. When a single branch lands across layers — `packages/database` schema/model → a shared `packages/*` lib → `src/server` TRPC → `apps/desktop` + `apps/cli` callers → `src/features` UI — shipping it as one PR can't merge safely: the clients call an endpoint that doesn't exist on the trunk until the same PR merges, so any partial/rollback or independent review breaks. Split it into **ordered PRs**, lower layer first.

## The ordering rule

A PR may only merge **after** every layer it calls is already on the trunk.

- The **server contract** (new TRPC procedure, changed return shape, new table/model) merges first.
- The **callers** (desktop, CLI, UI) merge after — they invoke that contract.
- Tie-break with one question: _"if this merged alone to `canary` right now, would it build and behave?"_ If no, it belongs in a later PR.

## Which file goes in which PR

The non-obvious calls:

- **Frontend that adapts to a contract change goes WITH the server PR.** If you widen a TRPC return shape (e.g. `listDevices` now returns `platform: string | null`), the component consuming it must change in the _same_ PR — otherwise the server PR breaks the build on its own. Contract + its in-repo consumers ship together.
- **A new shared package goes with its consumer**, not the server, unless the server imports it too. A `@lobechat/*` package imported only by desktop/CLI ships in the client PR. Don't carry an unused package in the lower PR.
- **Workspace dep declarations** (`package.json` `workspace:*`, `pnpm-workspace.yaml`) travel with the code that imports the package.

## The git recipe — split an existing full branch

Starting point: one branch (`feat/x`) with a single commit `<FULL>` containing everything, already pushed (so it's also safe on the remote).

```bash
# 1. Safety nets — make the full work unloseable before rewriting anything
git branch backup/x-full <FULL>          # local ref to the full commit
git branch feat/x-clients <FULL>         # the higher-layer branch starts here

# 2. Rewrite the lower-layer branch to lower-layer files only
git checkout feat/x                      # this becomes the SERVER PR
git reset --hard origin/canary
git checkout <FULL> -- <server/db files…>   # stages just those paths
git commit -m "✨ feat(...): <server half>"
git push --force-with-lease origin feat/x   # never --force; never push to canary

# 3. Build the higher-layer branch STACKED on the lower branch
git checkout feat/x-clients
git reset --hard feat/x                  # base = the just-rewritten server HEAD
git checkout backup/x-full -- <client/ui files…>   # only the remaining paths
git commit -m "✨ feat(...): <client half>"
git push -u origin feat/x-clients
```

Then open the higher PR **based on the lower branch**, not the trunk:

```bash
gh pr create --base feat/x --head feat/x-clients --title "…" --body "…"
```

`--base feat/x` keeps the diff client-only (no server files leak in) and makes it physically impossible to merge the clients before the server. **After the server PR merges to `canary`, retarget the client PR's base to `canary`** (GitHub usually auto-retargets when the base branch merges; note it in the PR body so a human confirms).

## Verify the dependency actually holds

The whole point is the higher layer needs the lower one. Prove it: on the stacked higher branch, type-check the caller and confirm the symbol the lower layer introduced resolves.

```bash
cd apps/cli && bun run type-check 2>&1 | grep -iE "connect\.ts|device\.register"
# empty (re: your change) = the stacked base supplies device.register ✓
```

Filter to your touched files — this repo's standalone type-check emits pre-existing env noise (`__ELECTRON__`, `@/types/llm`, unbuilt `@lobechat/types`) that isn't yours.

## PR + Linear bookkeeping

- **Each PR closes only its own layer's issues.** Server PR: `Closes LOBE-<server>`. Client PR: `Closes LOBE-<pkg> / <desktop> / <cli>`. Don't let one PR's body claim another layer's issue.
- Both PRs are `Part of LOBE-<parent>`.
- On PR creation, move each closed sub-issue to **In Review** (not Done) and add a completion comment — see the `linear` skill.

## Gotchas

- **Never push to `canary`.** A split branch cut with `git checkout -b feat/x origin/canary` _tracks_ `origin/canary`, so a bare `git push` targets canary. Always `git push origin feat/x` with the explicit branch name.
- **`--force-with-lease`, not `--force`** when rewriting the lower branch — it aborts if the remote moved under you.
- **Back up before `reset --hard`.** Step 1's `backup/x-full` + the pushed remote branch mean the full commit is referenced by ≥3 refs before you rewrite anything. Verify with `git branch --contains <FULL>`.
- **Lockfiles:** this monorepo commits no root `pnpm-lock.yaml`, so a new `workspace:*` dep needs no lockfile churn. In a repo that _does_ commit one, regenerate it on each branch after the split.
- **Don't over-split.** Two PRs (contract / callers) is usually enough. A UI page that only reads an existing endpoint can be its own later PR, but don't fragment a single layer across PRs for its own sake.
