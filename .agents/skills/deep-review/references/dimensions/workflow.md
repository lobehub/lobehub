---
id_prefix: flow
verify: false
skip_when: never in deep mode (cheap external-state checks)
---

# Workflow

Is the process around this change healthy? These are objective state checks — findings report facts (a failing check, a stale description), so they skip the verify pass and go straight to the report.

## Quick checklist

- Tracked issue exists for non-trivial work (Linear for team members — see `.agents/skills/linear/`; GitHub issue otherwise) and its status matches reality
- PR description still matches the diff — scope drift after review rounds leaves descriptions describing code that no longer exists
- Key decisions made during implementation (trade-offs, rejected alternatives, scope cuts) recorded in the issue/PR, not only in a chat transcript
- Decision records still match the implementation: when the implementation legitimately diverged from a decision written earlier in the issue/PR/conversation, the record is updated in the same PR — a stale decision record misleads every later reader, and reviewers without the session context can only trust what is written
- CI green; preview/deployment build succeeded — a red or pending-forever check is a finding with the failing job named
- PR targets the right branch (this repo: feature PRs → `canary`; DB schema changes ride a separate branch PR'd to `main` first)
- Commit messages follow repo convention (gitmoji prefix)
- Locale files: new keys shipped with en-US + zh-CN per the i18n workflow; other locales left to the auto-i18n CI

## Rule sources

- `.agents/skills/linear/SKILL.md`, `.agents/skills/pr/SKILL.md` — expected issue/PR lifecycle
- Repo `AGENTS.md` — branch strategy, commit conventions

## How to check

1. `gh pr view <num> --json title,body,baseRefName,statusCheckRollup,isDraft` — compare body against the actual diff; read check rollup.
2. Search the PR body/commits for an issue reference; if the environment has the issue tracker connected, fetch the issue and compare status.
3. `git log <base>..HEAD --oneline` — scan message format.

## Violations

- Any quick-checklist item observably false, with the evidence (failing job name, missing reference, drifted paragraph) quoted.

## Not violations

- Process steps that explicitly don't apply (trivial one-line fixes may not need an issue; drafts may have pending CI).
- Missing ceremony this repo does not practice — check the repo's own conventions, not an imagined ideal process.
