---
name: version-release
description: "Version release workflow. Use when the user mentions 'release', 'hotfix', 'version upgrade', 'weekly release', or '发版'/'发布'/'小班车'. Provides guides for Minor Release and Patch Release workflows."
---

# Version Release Workflow

## Mandatory Companion Skill

For every `/version-release` execution, you MUST load and apply:

- `../microcopy/SKILL.md`

Changelog style guidance is now fully embedded in this skill. Keep release facts unchanged, and only improve structure, readability, and tone.

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
| DB Schema Migration | main          | `release/db-migration-{name}` | Database migration, requires dedicated changelog |

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

### Precheck

Before creating the release branch, verify the source branch:

- **Weekly Release** (`release/weekly-*`): must branch from `canary`
- **All other release/hotfix branches**: must branch from `main` — run `git merge-base --is-ancestor main <branch> && echo OK` to confirm
- If the branch is based on the wrong source, delete and recreate from the correct base

### Patch Release

Choose the appropriate workflow based on the scenario (see `reference/patch-release-scenarios.md`):

- **Weekly Release**: Create a `release/weekly-{YYYYMMDD}` branch from canary, scan `git log main..canary` to write the changelog, title like `🚀 release: 20260222`
- **Bug Hotfix**: Create a `hotfix/` branch from main, use a gitmoji prefix title (e.g. `🐛 fix: ...`)
- **New Model Launch**: Community PRs trigger automatically via title prefix (`feat` / `style`), no extra steps needed
- **DB Migration**: Create a `release/db-migration-{name}` branch from main, cherry-pick migration commits, write a dedicated migration changelog

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

### Mandatory Inputs Before Writing

1. Release diff context (`git log main..canary` and/or `git diff main...canary --stat`)
2. Existing release template constraints (title, credits, trigger rules)
3. `../microcopy/SKILL.md` terminology constraints

### Output Constraints (Hard Rules)

1. Keep all factual claims accurate to merged changes.
2. Do not invent numbers, scope, timelines, or availability tiers.
3. Keep release title and trigger-sensitive format unchanged.
4. Keep `Credits` section intact (format required by project conventions).
5. Prefer fewer headings and more natural narrative paragraphs.
6. EN/ZH versions must cover the same facts in the same order.
7. Prefer storytelling over feature enumeration.
8. Avoid `Key Updates` sections that are only bullet dumps unless explicitly requested.

### Editorial Voice (Notion/Linear-Inspired)

Target a changelog voice that is calm, confident, and human:

- Start from user reality, not internal implementation.
- Explain why this change matters before listing mechanics.
- Keep tone practical and grounded, but allow a little product warmth.
- Favor concrete workflow examples over abstract claims.
- Write like an update from a thoughtful product team, not a marketing launch page.

### Writing Model (3-Pass Rewrite)

#### Pass 1: Remove AI Vocabulary and Filler

- Replace inflated words with simple alternatives.
- Remove transition padding like "furthermore", "notably", "it is worth noting that".
- Cut generic importance inflation ("pivotal", "testament", "game-changer").
- Prefer direct verbs like `run`, `customize`, `manage`, `capture`, `improve`, `fix`.

#### Pass 2: Break AI Sentence Patterns

Avoid these structures:

- Parallel negation: "Not X, but Y"
- Tricolon overload: "A, B, and C" used repeatedly
- Rhetorical Q + answer: "What does this mean? It means..."
- Dramatic reveal openers: "Here's the thing", "The result?"
- Mirror symmetry in consecutive lines
- Overuse of em dashes
- Every paragraph ending in tidy "lesson learned" phrasing

#### Pass 3: Add Human Product Texture

- Lead with user-visible outcome, then explain mechanism.
- Mix sentence lengths naturally.
- Prefer straightforward phrasing over polished-but-empty language.
- Keep confidence, but avoid launch-ad hype.
- Write like a product team update, not a marketing page.

### Recommended Structure Blueprint

Use this shape unless the user asks otherwise:

1. `# 🚀 release: ...`
2. One opening paragraph (2-4 sentences) that explains overall user impact.
3. 2-4 narrative capability blocks (short headings optional):
   - each block = user value + key capability
4. `Improvements and fixes` / `体验优化与修复` with concise bullets
5. `Credits` with required mention format

### Length and Reading Density (Important)

Avoid overly short release notes when the diff is substantial.

- Weekly release PR body:
  - Usually target 350-700 English words (or equivalent Chinese length)
  - Keep 2-4 narrative sections, each with at least one real paragraph
- Minor release PR body:
  - Usually target 500-1000 English words (or equivalent Chinese length)
  - Allow richer context and more concrete usage scenarios
- DB migration release PR body:
  - Keep concise, but still include context + impact + operator notes
- If there are many commits, increase narrative depth before adding more bullets.
- If there are few commits, stay concise and do not pad content.

### Storytelling Contract (Major Capabilities)

For each major capability, write in this order:

1. Prior context/problem (briefly)
2. What changed in this release
3. Practical impact on user workflow

Do not collapse major capability sections into one-line bullets.

### Section Anatomy (Preferred)

Each major section should follow this internal rhythm:

1. Lead sentence: what changed and who benefits.
2. Context sentence: what was painful, slow, or fragmented before.
3. Mechanism paragraph: how the new behavior works in practice.
4. Optional utility list (`Use X to:`) for actionable workflows.
5. Optional availability closer when plan/platform constraints matter.

This pattern increases readability and makes changelogs more enjoyable to read without sacrificing precision.

### Section and Heading Heuristics

- Keep heading count low (typically 3-5).
- Weekly release PR body target:
  - 1 opening paragraph
  - 2-4 major narrative sections
  - 1 improvements/fixes section
  - 1 credits section
- Never produce heading-per-bullet layout.
- If a section has 4+ bullets, convert into 2-3 short narrative paragraphs when possible.

### Linear-Style Block Pattern

Use this pattern when writing major sections:

```md
## <Capability name>

<One sentence: what users can do now and why it matters.>

<One short paragraph: how this works in practice, in plain language.>

<Optional list for workflows>
Use <feature> to:
- <practical action 1>
- <practical action 2>
- <practical action 3>

<Optional availability sentence>
```

### Notion-Style Readability Moves

Apply these moves when appropriate:

- Use one clear "scene" sentence to ground context (for example, what a team is doing when the feature helps).
- Alternate paragraph lengths: one compact paragraph followed by a denser explanatory one.
- Prefer specific nouns (`triage inbox`, `topic switch`, `mobile session`) over broad terms like "experience" or "workflow improvements".
- Keep transitions natural (`Previously`, `Now`, `In practice`, `This means`) and avoid ornate writing.
- End key sections with a practical takeaway sentence, not a slogan.

### Anti-Pattern Red Flags (Rewrite Required)

- "Key Updates" followed by only bullets and no narrative context
- One bullet per feature with no prior context or user impact
- Repeated template like "Feature X: did Y"
- Heading-per-feature with no explanatory paragraph
- Mechanical transitions with no causal flow

### EN/ZH Synchronization Rules

- Keep section order aligned.
- Keep facts and scope aligned.
- Localize naturally; avoid literal sentence mirroring.
- If one language uses bullets for a section, the other should match style intent.

### Writing Tips

- **User-facing**: Describe changes that users can perceive, not internal implementation details
- **Clear categories**: Group by features, models/providers, desktop, stability/fixes, etc.
- **Highlight key items**: Use `**bold**` for important feature names
- **Credit contributors**: Collect all committers via `git log` and list alphabetically
- **Flexible categories**: Choose categories based on actual changes — no need to force-fit all categories
- **Terminology enforcement**: Ensure wording follows `microcopy` skill terminology and tone constraints
- **Linear narrative enforcement**: Follow capability -> explanation -> optional "Use X to" list
- **Storytelling enforcement**: For major updates, write in "before -> now -> impact" order
- **Depth enforcement**: If the diff is non-trivial, prefer complete paragraphs over compressed bullet-only summaries
- **Pleasure-to-read enforcement**: Include concrete examples and practical scenarios so readers can imagine using the capability

### Quick Checklist

- [ ] First paragraph explains user-visible release outcome
- [ ] Heading count is minimal and meaningful
- [ ] Major capabilities are short narrative paragraphs, not only bullets
- [ ] Includes "before -> now -> impact" for major sections
- [ ] No obvious AI patterns (parallel negation, rhetorical Q/A, dramatic reveal)
- [ ] Vocabulary is plain, direct, and product-credible
- [ ] Improvements/fixes remain concise and scannable
- [ ] Credits format is preserved exactly
- [ ] EN/ZH versions align in facts and order
