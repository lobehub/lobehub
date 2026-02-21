---
name: version-release
description: "Version release workflow. Use when the user mentions 'release', 'hotfix', 'version upgrade', 'weekly release', or '发版'/'发布'/'小班车'. Provides guides for Minor Release and Patch Release workflows."
---

# Version Release Workflow

## Overview

The primary development branch is **canary**. All day-to-day development happens on canary. When releasing, canary is merged into main. After merge, `auto-tag-release.yml` automatically handles tagging, version bumping, creating a GitHub Release, and syncing back to the canary branch.

Only two release types are used in practice (major releases are extremely rare and can be ignored):

| Type  | Use Case                                       | Frequency             | Source Branch  | PR Title Format                      | Version       |
| ----- | ---------------------------------------------- | --------------------- | -------------- | ------------------------------------ | ------------- |
| Minor | Feature iteration release                      | \~Every 4 weeks       | canary         | `🚀 release: v{x.y.0}`               | Manually set  |
| Patch | Weekly release / hotfix / model / DB migration | \~Weekly or as needed | canary or main | Custom (e.g. `🚀 release: 20260222`) | Auto patch +1 |

## Minor Release Workflow

Used to publish a new minor version (e.g. v2.2.0), roughly every 4 weeks.

### Steps

1. **Create a release branch from canary**

```bash
git checkout canary
git pull origin canary
git checkout -b release/v{version}
git push -u origin release/v{version}
```

2. **Determine the version number** — Read the current version from `package.json` and compute the next minor version (e.g. 2.1.x → 2.2.0)

3. **Create a PR to main**

```bash
gh pr create \
  --title "🚀 release: v{version}" \
  --base main \
  --head release/v{version} \
  --body "## 📦 Release v{version} ..."
```

> \[!IMPORTANT]: The PR title must strictly match the `🚀 release: v{x.y.z}` format. CI uses a regex on this title to determine the exact version number.

4. **Automatic trigger after merge**: auto-tag-release detects the title format and uses the version number from the title to complete the release.

### Scripts

```bash
bun run release:branch         # Interactive
bun run release:branch --minor # Directly specify minor
```

## Patch Release Workflow

Version number is automatically bumped by patch +1. There are 4 common scenarios:

| Scenario            | Source Branch | Branch Naming                 | Description                                      |
| ------------------- | ------------- | ----------------------------- | ------------------------------------------------ |
| Weekly Release      | canary        | `release/weekly-{YYYYMMDD}`   | Weekly release train, canary → main              |
| Bug Hotfix          | main          | `hotfix/v{version}-{hash}`    | Emergency bug fix                                |
| New Model Launch    | canary        | Community PR merged directly  | New model launch, triggered by PR title prefix   |
| DB Schema Migration | canary        | `release/db-migration-{name}` | Database migration, requires dedicated changelog |

All scenarios auto-bump patch +1. Patch PR titles do not need a version number. See `reference/patch-release-scenarios.md` for detailed steps per scenario.

### Scripts

```bash
bun run hotfix:branch # Hotfix scenario
```

## Auto-Release Trigger Rules (auto-tag-release.yml)

After a PR is merged into main, CI determines whether to release based on the following priority:

### 1. Minor Release (Exact Version)

PR title matches `🚀 release: v{x.y.z}` → uses the version number from the title.

### 2. Patch Release (Auto patch +1)

Triggered by the following priority:

- **Branch name match**: `hotfix/*` or `release/*` → triggers directly (skips title detection)
- **Title prefix match**: PRs with the following title prefixes will trigger:
  - `style` / `💄 style`
  - `feat` / `✨ feat`
  - `fix` / `🐛 fix`
  - `refactor` / `♻️ refactor`
  - `hotfix` / `🐛 hotfix` / `🩹 hotfix`
  - `build` / `👷 build`

### 3. No Trigger

PRs that don't match any of the above conditions (e.g. `docs`, `chore`, `ci`, `test` prefixes) will not trigger a release when merged into main.

## Post-Release Automated Actions

1. **Bump package.json** — commits `🔖 chore(release): release version v{x.y.z} [skip ci]`
2. **Create annotated tag** — `v{x.y.z}`
3. **Create GitHub Release**
4. **Dispatch sync-main-to-canary** — syncs main back to the canary branch

## Claude Action Guide

When the user requests a release:

### Minor Release

1. Read `package.json` to get the current version and compute the next minor version
2. Create a `release/v{version}` branch from canary
3. Push and create a PR — **title must be `🚀 release: v{version}`**
4. Inform the user that merging the PR will automatically trigger the release

### Patch Release

Choose the appropriate workflow based on the scenario (see `reference/patch-release-scenarios.md`):

- **Weekly Release**: Create a `release/weekly-{YYYYMMDD}` branch from canary, scan `git log main..canary` to write the changelog, title like `🚀 release: 20260222`
- **Bug Hotfix**: Create a `hotfix/` branch from main, use a gitmoji prefix title (e.g. `🐛 fix: ...`)
- **New Model Launch**: Community PRs trigger automatically via title prefix (`feat` / `style`), no extra steps needed
- **DB Migration**: Create a `release/db-migration-{name}` branch from canary, write a dedicated migration changelog

### Important Notes

- **Do NOT manually modify the version in package.json** — CI will auto-bump it
- **Do NOT manually create tags** — CI will create them automatically
- The Minor Release PR title format is a hard requirement — incorrect format will not use the specified version number
- Patch PRs do not need a version number — CI auto-bumps patch +1
- All release PRs must include a user-facing changelog

## Changelog Writing Guidelines

All release PR bodies (both Minor and Patch) must include a user-facing changelog. Scan changes via `git log main..canary --oneline` or `git diff main...canary --stat`, then write following the format below.

### Format Reference

- Weekly Release: See `reference/changelog-example/weekly-release.md`
- DB Migration: See `reference/changelog-example/db-migration.md`

### Writing Tips

- **User-facing**: Describe changes that users can perceive, not internal implementation details
- **Clear categories**: Group by features, models/providers, desktop, stability/fixes, etc.
- **Highlight key items**: Use `**bold**` for important feature names
- **Credit contributors**: Collect all committers via `git log` and list alphabetically
- **Flexible categories**: Choose categories based on actual changes — no need to force-fit all categories
