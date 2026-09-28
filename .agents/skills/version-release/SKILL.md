---
name: version-release
description: 'Version release workflow — release process and GitHub Release notes (not docs/changelog pages).'
disable-model-invocation: true
argument-hint: '[minor|patch] [version?]'
---

# Version Release Workflow

This skill is a router. The detailed steps live in `references/`.

## Scope Boundary (Important)

This skill is only for:

1. Release branch / PR workflow
2. CI trigger constraints (`auto-tag-release.yml`)
3. GitHub Release note writing

This skill is **not** for writing `docs/changelog/*.mdx`.\
If the user asks for website changelog pages, load `../docs-changelog/SKILL.md`.

## Mandatory Companion Skill

For every `/version-release` execution, you MUST load and apply:

- `../../../DESIGN.md` (Voice & Content)

## Overview

The primary development branch is **canary**. All day-to-day development happens on canary. When releasing, canary is merged into main. Conventional release PRs (`🚀 release: …`, `release/*`, `hotfix/*`) get a `package.json` bump commit from `release-pr-version.yml` while the PR is open. After merge, `auto-tag-release.yml` tags the merge commit and creates the GitHub Release. `sync-main-to-canary` runs on push to `main`.

Only two release types are used in practice (major releases are extremely rare and can be ignored):

| Type  | Use Case                                       | Frequency             | Source Branch  | PR Title Format                      | Version       | Reference                               |
| ----- | ---------------------------------------------- | --------------------- | -------------- | ------------------------------------ | ------------- | --------------------------------------- |
| Minor | Feature iteration release                      | \~Every 4 weeks       | canary         | `🚀 release: v{x.y.0}`               | Manually set  | `references/minor-release.md`           |
| Patch | Weekly release / hotfix / model / DB migration | \~Weekly or as needed | canary or main | Custom (e.g. `🚀 release: 20260222`) | Auto patch +1 | `references/patch-release-scenarios.md` |

For writing the release-note body (any release type), see `references/release-notes-style.md`.

## Auto-Release Trigger Rules (`auto-tag-release.yml`)

After a PR is merged into main, CI determines whether to release based on the following priority:

### 1. Minor Release (Exact Version)

PR title matches `🚀 release: v{x.y.z}` -> uses the version number from the title.

### 2. Patch Release (Auto patch +1)

Triggered by the following priority:

- **Branch name match**: `hotfix/*` or `release/*` -> triggers directly (skips title detection)
- **Title prefix match**: PRs with the following title prefixes will trigger:
  - `style` / `💄 style`
  - `feat` / `✨ feat`
  - `fix` / `🐛 fix`
  - `refactor` / `♻️ refactor`
  - `hotfix` / `🐛 hotfix` / `🩹 hotfix`
  - `build` / `👷 build`

### 3. No Trigger

PRs that don't match any conditions above (e.g. `docs`, `chore`, `ci`, `test`) will not trigger a release when merged into main.

## Automated Actions

1. **On the release PR** (`release-pr-version.yml`) — if `package.json` is behind, commit `🔖 chore(release): release version v{x.y.z}` to the PR head. Minor titles `🚀 release: v{x.y.z}` use that version; weekly / `release/*` / `hotfix/*` use latest stable tag + patch.
2. **After merge** (`auto-tag-release.yml`) — tag `v{x.y.z}` on the merge commit and create the GitHub Release. Patch version is latest stable tag +1, not `package.json` +1.
3. **`sync-main-to-canary`** — runs on push to `main`.

## Agent Action Guide

When the user requests a release:

### Precheck (applies to all release types)

Before creating the release branch, verify the source branch:

- **Weekly Release** (`release/weekly-*`): must branch from `canary`
- **All other release/hotfix branches**: must branch from `main`; run `git merge-base --is-ancestor main <branch> && echo OK`
- If the branch is based on the wrong source, recreate from the correct base

### Routing

Pick the right reference and follow it end-to-end:

- **Minor release** → `references/minor-release.md`
- **Patch release** (weekly / hotfix / model launch / DB migration) → `references/patch-release-scenarios.md`
- **Writing the PR body / release notes** (any release type) → `references/release-notes-style.md`

### Hard Rules (apply to every release type)

- **Do NOT** manually modify `package.json` version — CI handles it.
- **Do NOT** manually create tags — CI handles them.
- Minor PR title format is strict (`🚀 release: v{x.y.z}`).
- Patch PRs do not need an explicit version number.
- Keep release facts accurate; do not invent metrics or availability statements. Release-note inputs (compare base, PR refs, contributor list) **must be derived from `git`** per `references/release-notes-style.md` § Computing Inputs — never from memory or descriptions.
