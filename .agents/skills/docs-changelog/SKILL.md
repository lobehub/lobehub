---
name: docs-changelog
description: 'Writing guide for website changelog pages under docs/changelog/*.mdx. Use when creating or editing product update posts in EN/ZH. Not for GitHub Release notes.'
---

# Docs Changelog Writing Guide

## Scope Boundary (Important)

This skill is only for changelog pages in:

- `docs/changelog/*.mdx`

This skill is **not** for GitHub Releases.\
If the user asks for release PR body / GitHub Release notes, load `../version-release/SKILL.md`.

## Mandatory Companion Skills

For every docs changelog task, you MUST load:

- `../microcopy/SKILL.md`
- `../i18n/SKILL.md` (when EN/ZH pair is involved)

## File and Naming Convention

Use date-based file names:

- English: `docs/changelog/YYYY-MM-DD-topic.mdx`
- Chinese: `docs/changelog/YYYY-MM-DD-topic.zh-CN.mdx`

EN and ZH files must exist as a pair and describe the same release facts.

## Frontmatter Requirements

Each file should include:

```md
---
title: <Title>
description: <1 sentence summary>
tags:
  - <Tag 1>
  - <Tag 2>
---
```

Rules:

1. `title` should match the H1 title in meaning.
2. `description` should be concise and user-facing.
3. `tags` should be feature-oriented, not internal-team labels.

## Content Structure (Recommended)

Use this shape unless the user requests otherwise:

1. `# <Title>`
2. Opening paragraph (2-4 sentences): user-visible impact
3. 1-3 capability sections (optional `##` headings)
4. `## Improvements and fixes` / `## 体验优化与修复` with concise bullets

Keep heading count low and avoid heading-per-bullet structure.

## Writing Rules

1. Keep all claims factual and tied to actual shipped changes.
2. Explain user value first, implementation second.
3. Prefer natural narrative paragraphs over pure bullet dumps.
4. Avoid marketing exaggeration and vague adjectives.
5. Keep internal terms consistent across EN/ZH files.
6. Keep EN/ZH section order aligned and scope-aligned.

## EN/ZH Synchronization Rules

When generating bilingual changelogs:

1. Keep the same key facts in the same order.
2. Localize naturally; do not do literal sentence-by-sentence translation.
3. If one version has an `Improvements and fixes` bullet list, the other should have equivalent list intent.
4. Do not introduce capabilities in only one language unless explicitly requested.

## Length Guidance

- Small update: 3-5 short paragraphs total
- Medium update: 4-7 short paragraphs + concise fix bullets
- Large update: 6-10 short paragraphs split into 2-4 sections

Do not pad content when changes are limited.

## Authoring Workflow

1. Collect source facts from PRs/commits/issues.
2. Group changes by user workflow (not by internal module path).
3. Draft EN and ZH versions with aligned structure.
4. Verify terminology using `microcopy`/`i18n` guidance.
5. Final pass: remove AI-like filler and tighten sentences.

## Docs Changelog Template (English)

```md
---
title: <Feature title>
description: <One-sentence summary for users>
tags:
  - <Tag A>
  - <Tag B>
---

# <Feature title>

<Opening paragraph: what changed for users and why it matters.>

<Optional section paragraph for key capability 1.>

<Optional section paragraph for key capability 2.>

## Improvements and fixes

- <Fix or optimization 1>
- <Fix or optimization 2>
```

## Docs Changelog Template (Chinese)

```md
---
title: <功能标题>
description: <一句话说明>
tags:
  - <标签 A>
  - <标签 B>
---

# <功能标题>

<开场段：这次更新给用户带来的直接变化。>

<可选能力段 1。>

<可选能力段 2。>

## 体验优化与修复

- <优化或修复 1>
- <优化或修复 2>
```

## Quick Checklist

- [ ] File path matches `docs/changelog` naming convention
- [ ] EN and ZH versions both exist and match in facts
- [ ] Opening paragraph explains user-facing outcome
- [ ] Main body is narrative-first, not bullet-only
- [ ] `Improvements and fixes` section is concise and concrete
- [ ] No fabricated claims or unsupported scope
