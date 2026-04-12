---
name: pr
description: "Create a PR for the current branch. Use when the user asks to create a pull request, submit PR, or says 'pr'."
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
