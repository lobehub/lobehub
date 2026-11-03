---
name: linear
description: 'Use for Linear issues, LOBE-xxx links, status updates, completion comments and sub-issue trees.'
user-invocable: false
---

# Linear Issue Management

Before using Linear workflows, discover the available Linear tools, including deferred tools, and inspect their current schemas. Select tools by capability (issue lookup, images, sub-issues, create/update, comments), not a fixed MCP prefix or historical tool name. Report a missing capability only after discovery.

## Workflow

1. **Retrieve issue details** before starting using the issue lookup capability.
2. **Read images** — issue descriptions often contain screenshots with critical context (mockups, error states, before/after). Use the available image extraction or viewing capability; reading raw markdown alone misses what the reporter was looking at.
3. **Check for sub-issues** using the available parent filter or issue relation fields.
4. **Mark as In Progress** at the moment you start planning or implementing — this signals to teammates the issue is owned, so they don't double-pick it up.
5. Follow [Per-Issue Completion](#per-issue-completion) before moving to the next issue.

## Creating Issues

When creating issues, add the `claude code` label. Reason: the label is how the team filters/audits AI-generated issues; without it those issues vanish into the general backlog and the team loses visibility into AI contribution patterns.

Unless the user explicitly specifies another assignee or asks for the issue to remain unassigned, pass `assignee: "me"` so the issue is assigned to the authenticated Linear user. Always honor explicit assignment instructions over this default.

## Language

Match the issue language to the conversation that produced it — if you're discussing in 中文，write the issue in 中文；if discussing in English, write it in English. Reason: the issue is a continuation of the conversation, and forcing a language switch creates translation friction for the collaborator who started the thread.

Specifics:

- 中文 conversation → 中文 body; technical terms (file paths, identifiers, library names, commands, error messages) stay in English.
- English conversation → English body.
- Code blocks, file paths, and quoted strings always stay in their original form regardless of surrounding language.
- This applies equally to **updates** — when editing an existing issue (description **and titles**), preserve the language of the conversation that triggered the edit; don't switch the issue language mid-refactor.

## Creating Sub-issue Trees

When breaking a parent issue into a tree of sub-issues (e.g., task decomposition for LOBE-xxx), follow these conventions and check the available tool capabilities.

### 1. Prefix titles with an ordering index

Linear supports sub-issue ordering, but tool support varies. Check the discovered create/update schema for ordering fields rather than assuming a particular MCP tool exposes them.

Workaround: encode execution order in the title itself:

```plaintext
[1]     [db]       add schema fields
[2]     [db]       new table + repository
[3]     [service]  business logic layer
[4]     [api]      REST endpoints
[4.1]   [sdk]      client SDK wrapper
[4.1.1] [app]      consumer integration
[4.1.2] [app]      UI surface
[4.2]   [ui]       dashboard page
```

Even when the panel shuffles, the reader can mentally reconstruct the dependency graph at a glance. Dotted numbering `[n.m.k]` should mirror the parent-child nesting so the index and the tree agree.

### 2. Nest sub-issues by logical parent-child, not flat under the root

Linear supports **unlimited sub-issue depth**. A flat list of 8+ siblings under one root is hard to scan. Group by main-subordinate logic:

- Core service → its SDK → SDK consumers
- Don't create a sibling when a child is more accurate

Set the parent relation when creating or moving an issue using the discovered schema (for example, `parentId: "LOBE-xxxx"` when supported). Moving the parent does not require rewriting `blockedBy` relations.

### 3. Sub-issue creation order is dictated by `blockedBy`

`blockedBy` requires the blocker to exist first (you need its LOBE-id). So:

1. **Topologically sort** the DAG — leaves (no deps) first, roots last
2. Create issues with zero deps in the first wave
3. Create dependent issues only after collecting the blocker IDs from prior responses
4. `blockedBy` is **append-only**; passing it again does not overwrite — safe to re-run

### 4. Respect dependency order

Collect blocker IDs before creating dependent issues. Do not assume parallel execution from how tool calls appear in a message; use the active tool's supported execution behavior.

### 5. Keep each sub-issue description self-contained

Each sub-issue should state:

- Goal (1–2 lines)
- Key files to touch
- Concrete changes / acceptance criteria
- Dependencies (link to blocker issues by `LOBE-xxxx`)
- Validation steps

The implementer may open only the sub-issue, not the parent — don't rely on context that lives only in the parent description.

## Per-Issue Completion

Close out each issue before starting the next; do not defer all Linear updates to the end. Reuse existing authorization for that issue's status updates and comments without asking again.

1. Complete implementation and the repository-required checks, including related tests; follow the Quality Check section of the repository's `AGENTS.md` (`bun run check` in LobeHub).
2. Create a PR when needed using the **pr** skill. Include `Fixes LOBE-123` (or `Closes` / `Resolves`) in the PR body so Linear can link it and close the issue on merge.
3. Update the issue to **In Review** while its PR awaits merge, then **Done** after merge. For work that needs no PR, mark **Done** when its outcome and verification are complete.
4. Proactively add or update a concise completion comment with the resulting behavior, important changes, validation, and PR link. PR linkage does not replace this human-readable summary. If an existing comment already covers the same result, do not post a duplicate.
