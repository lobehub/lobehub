# Step 0 — Scope & Background (shared by all environments)

Determine what to review, produce the scope summary, and decide whether to inline the diff or pass fetch commands. Light mode uses the same scope rules (steps 1–4), skipping the background hunt when conversation context already explains the change.

## 1. Probe size with stat-level commands first

- PR: `gh pr view <num> --json title,body,files,baseRefName,headRefName`
- Branch: `git diff <base>...HEAD --stat`
- Uncommitted: `git diff HEAD --stat` + `git status --short`

### Range hard rules (do not review other people's commits)

**`git diff` is always three-dot** (`<base>...HEAD`), never two-dot. Two-dot `diff` against a base that has moved (`origin/main..HEAD`) injects other people's freshly merged commits as reverse changes. Three-dot diffs from the merge-base, yielding what this branch introduced. (`git log` is the opposite — see the sanity check below.)

Three-dot alone is not enough — the **base ref must not lag the branch's real fork point**. If the branch was rebased onto a newer remote default while the local default still points at an older commit, that local ref is now an ancestor of HEAD, so `<local-default>...HEAD` has its merge-base at the stale commit and hands you every upstream commit the rebase pulled in. Pick the base in this order:

1. **PR mode** → the PR's `baseRefName` at its merge-base; `gh pr diff <num>` already scopes correctly, prefer it over any hand-built range.
2. **`git fetch` first, then `origin/<default>...HEAD`** — the fetched remote ref is the one that cannot lag, and three-dot makes it safe in both cases (rebased branch → merge-base is the rebase base; never-rebased branch → merge-base is the original fork point).
3. **Local `<default>...HEAD`** only after confirming local is not behind (`git rev-list --count <local-default>..origin/<default>` is 0, or there is no remote).

Sanity-check whichever you pick before reviewing: `git log --oneline <base>..HEAD` — **two** dots — must list only this branch's commits. Someone else's commit in that list means the base is wrong; fix the base, do not review around it.

Note the asymmetry, it is the easiest mistake here: `log` wants **two** dots where `diff` wants **three**. `git log <base>..HEAD` and `git diff <base>...HEAD` describe the same set of commits (merge-base → HEAD). `git log <base>...HEAD` is a symmetric difference and additionally lists everything the base gained after the fork — run that one and a perfectly correct base looks broken.

## 2. Pick the full-diff command by review target

1. **User named a PR by URL or an unambiguous PR phrase** (`PR #123`, `pr 123`,
   `pull request 123`) → `gh pr diff <num>`. Also fetch
   `gh pr view <num> --json mergeable,isDraft,reviewDecision,statusCheckRollup` and append those
   fields to the scope summary. A bare `#123` remains ambiguous and does not trigger PR mode.
2. **User named a specific commit or range** (a SHA, `abc123..def456`) → review exactly that object: `git show <sha> --stat` then `git show <sha>` for a single commit, `git diff <a>..<b>` for a range. The named object IS the scope — ignore branch/worktree state and do not fall through to the rules below.
3. **Non-default branch AND uncommitted changes both exist** → ask the user which to review: uncommitted only (`git diff HEAD` + untracked files read separately), committed branch work (`git diff <base>...HEAD`), or both (`git diff $(git merge-base <base> HEAD)` — worktree against the merge-base; the plain one-commit form `git diff <base>` would re-import default-branch advances as reverse diffs). Gitlink-only entries (`M <submodule>` where `git status` shows `(new commits)` and nothing else changed) do NOT count as uncommitted changes — a superproject tracking an in-flight submodule branch shows this permanently; route them through §4 instead of triggering this question.
4. **Uncommitted changes on the default branch** → `git diff HEAD`; list untracked via `git ls-files --others --exclude-standard` (§3 defines how their contents join `{changes}` — `git diff HEAD` alone misses them entirely).
5. **Clean tree on a non-default branch** → `git diff <base>...HEAD`
6. None of the above → ask; don't guess.

## 3. Exclude bulk files before judging size

Filter lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`, ...), snapshots (`*.snap`), generated files (`*.generated.*`, `*.gen.ts`), and build output (`dist/`, `build/`, `.next/`) from both stat and full-diff commands:

```bash
git diff "$BASE"...HEAD --stat -- . \
  ':(exclude)pnpm-lock.yaml' ':(exclude)*.snap' ':(exclude)dist/**'
```

Then judge with filtered numbers, checking in this order (very large first, so a few-files-but-huge diff never counts as small):

- **Very large diff** (> 1500 lines) → split into multiple review scopes by directory and run the flow in batches.
- **Small diff** (≤ 200 lines AND ≤ 5 files) → run the full-diff command now; the diff text becomes `{changes}`.
- **Large diff** (everything else) → do not fetch; the command itself (with excludes) becomes `{changes}`, subagents run it themselves.

Untracked files in an uncommitted scope are part of the review, not just a name list: count their line counts toward the size judgment; on the small-diff path append each untracked file's full content to `{changes}` (one fenced block per file, path as header); on the large-diff path list their paths next to the fetch commands so subagents read them.

Excluded files are out of scope; reviewing a lockfile on request is a separate task, not this flow.

## 4. Submodules

One change often spans the main repo and submodules — review them together by default.

1. Detect from the same command §2 selected — append `--submodule=log` to it (`git diff <base>...HEAD --submodule=log`, `git show <sha> --submodule=log`, `git diff <a>..<b> --submodule=log`, ...). `git status` showing `modified: <path> (new commits)` is an extra signal only when the scope includes the worktree (§2 rules 3–4); for a named commit/range the gitlink pair comes from that object, never from current branch/worktree state.
2. Changed submodules join the review: the old/new gitlink pair from that output yields the submodule diff command (`git -C <path> diff <old>..<new>`), which merges into `{changes}` alongside the main-repo command; sizes add up for the small/large judgment.
3. Prefix finding locations with the submodule path (`lobehub/src/x.ts:42`).
4. Note "main repo + submodule: <names>" in the scope summary. Skip a submodule only when the user explicitly says so.

## 5. Background (stop at the first source that answers)

1. **Conversation context** — deep mode usually runs right after implementation; the requirement is already here.
2. An issue the user referenced (issue tracker MCP / `gh issue view`).
3. The branch's PR: `gh pr list --head $(git branch --show-current)` → `gh pr view <num> --json title,body`.
4. Fallback: `git log <base>..HEAD --oneline` (commit messages are thin; last resort).

## 6. Produce the scope summary

Condense **changed-file list + requirement/acceptance criteria** into ≤ 200 words. Every subagent prompt carries it — it is the primary yardstick for "does this change violate the requirement".
