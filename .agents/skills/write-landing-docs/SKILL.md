---
name: write-landing-docs
description: 'Use for public LobeHub website documentation under docs/**, including self-hosting, deployment, migration, and configuration guides. Excludes product changelogs and source-code API docs.'
---

# Write Landing Docs

- Public website documentation is authored under `docs/**`.
- Read the `Voice & Content` section of `../../../DESIGN.md` before drafting.
- For `docs/self-hosting/**`, read [Default Audience](references/self-hosting.md).
- Verify claims, defaults, commands, limitations, and rollback behavior from current code.
- Prefer one canonical page, a recommended path, short executable steps, and a visible verification
  result. Keep English and Simplified Chinese versions aligned.
- If a published path changes, update internal links and add a tested permanent redirect in the
  landing repository that preserves locale prefixes and query parameters.
- Run the focused documentation check for every changed page.

For `docs/changelog/**`, use `../docs-changelog/SKILL.md` instead.
