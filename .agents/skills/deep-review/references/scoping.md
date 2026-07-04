# Step 0 — Scope & Background (shared by all environments)

Determine what to review, produce the scope summary, and decide whether to inline the diff or pass fetch commands. Light mode uses the same scope rules (steps 1–4), skipping the background hunt when conversation context already explains the change.

## 1. Probe size with stat-level commands first

- PR: `gh pr view <num> --json title,body,files,baseRefName,headRefName`
- Branch: `git diff <local-default-branch>...HEAD --stat`
- Uncommitted: `git diff HEAD --stat` + `git status --short`

### Range hard rules (do not review other people's commits)

`<local-default-branch>` is always the **local** ref (`main` / `canary` / ...), never `origin/<default>`. When local default lags the remote, `origin/main..HEAD` injects other people's freshly merged commits into the diff as reverse changes. Local ref + **three-dot** diff (`<local-default>...HEAD`) diffs from the merge-base, yielding exactly what this branch introduced.

No local default ref (detached HEAD, fresh clone)? `git fetch && git switch <default> && git switch -` to materialize one, or ask the user which base to use. Never fall back to `origin/<default>`.

## 2. Pick the full-diff command by review target

1. **User named a PR by URL** → `gh pr diff <num>`. Also fetch `gh pr view <num> --json mergeable,isDraft,reviewDecision,statusCheckRollup` and append those fields to the scope summary (feeds the merge-verdict table). URL only — bare `#123` does not trigger PR mode.
2. **User named a specific commit or range** (a SHA, `abc123..def456`) → review exactly that object: `git show <sha> --stat` then `git show <sha>` for a single commit, `git diff <a>..<b>` for a range. The named object IS the scope — ignore branch/worktree state and do not fall through to the rules below.
3. **Non-default branch AND uncommitted changes both exist** → ask the user which to review: uncommitted only (`git diff HEAD` + untracked files read separately), committed branch work (`git diff <local-default>...HEAD`), or both (`git diff $(git merge-base <local-default> HEAD)` — worktree against the merge-base; the plain one-commit form `git diff <local-default>` would re-import default-branch advances as reverse diffs). Gitlink-only entries (`M <submodule>` where `git status` shows `(new commits)` and nothing else changed) do NOT count as uncommitted changes — a superproject tracking an in-flight submodule branch shows this permanently; route them through §4 instead of triggering this question.
4. **Uncommitted changes on the default branch** → `git diff HEAD`; list untracked via `git ls-files --others --exclude-standard` (§3 defines how their contents join `{changes}` — `git diff HEAD` alone misses them entirely).
5. **Clean tree on a non-default branch** → `git diff <local-default>...HEAD`
6. None of the above → ask; don't guess.

## 3. Exclude bulk files before judging size

Filter lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`, ...), snapshots (`*.snap`), generated files (`*.generated.*`, `*.gen.ts`), and build output (`dist/`, `build/`, `.next/`) from both stat and full-diff commands:

```bash
git diff main...HEAD --stat -- . \
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

1. Detect from the same command §2 selected — append `--submodule=log` to it (`git diff <local-default>...HEAD --submodule=log`, `git show <sha> --submodule=log`, `git diff <a>..<b> --submodule=log`, ...). `git status` showing `modified: <path> (new commits)` is an extra signal only when the scope includes the worktree (§2 rules 3–4); for a named commit/range the gitlink pair comes from that object, never from current branch/worktree state.
2. Changed submodules join the review: the old/new gitlink pair from that output yields the submodule diff command (`git -C <path> diff <old>..<new>`), which merges into `{changes}` alongside the main-repo command; sizes add up for the small/large judgment.
3. Prefix finding locations with the submodule path (`lobehub/src/x.ts:42`).
4. Note "main repo + submodule: <names>" in the scope summary. Skip a submodule only when the user explicitly says so.

## 5. Background (stop at the first source that answers)

1. **Conversation context** — deep mode usually runs right after implementation; the requirement is already here.
2. An issue the user referenced (issue tracker MCP / `gh issue view`).
3. The branch's PR: `gh pr list --head $(git branch --show-current)` → `gh pr view <num> --json title,body`.
4. Fallback: `git log <local-default>..HEAD --oneline` (commit messages are thin; last resort).

## 6. Produce the scope summary

Condense **changed-file list + requirement/acceptance criteria** into ≤ 200 words. Every subagent prompt carries it — it is the primary yardstick for "does this change violate the requirement".
