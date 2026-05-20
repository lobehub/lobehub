---
name: linear
description: "Linear issue management. Use when the user mentions LOBE-xxx issue IDs (e.g. LOBE-4540), says 'linear' / 'linear issue' / 'link linear', or when creating PRs that reference Linear issues. Covers retrieving issues, updating status, adding completion comments, and creating sub-issue trees."
user-invocable: false
---

# Linear Issue Management

Before using Linear workflows, search for `linear` MCP tools. If not found, treat as not installed.

## PR Creation with Linear Issues

A PR that fixes a Linear issue has **two separate jobs to do**, and both matter:

1. **`Fixes LOBE-xxx` in the PR body** — Linear watches GitHub for these magic keywords and auto-links the PR and auto-closes the issue on merge. This is the machine-readable side.
2. **A completion comment on the Linear issue** — gives the reviewer/PM/teammate landing in Linear a human-readable summary of what changed and why, without forcing them to click through to GitHub and read a diff.

If you only do step 1, Linear watchers (often non-engineers) hit the issue and see no context. So pair PR creation with the Linear comment as part of the same task — finish both before considering the work done.

## Workflow

1. **Retrieve issue details** before starting: `mcp__linear-server__get_issue`
2. **Read images** — issue descriptions often contain screenshots with critical context (mockups, error states, before/after). Use `mcp__linear-server__extract_images` so you actually see them; reading raw markdown alone misses what the reporter was looking at.
3. **Check for sub-issues**: `mcp__linear-server__list_issues` with `parentId` filter
4. **Mark as In Progress** at the moment you start planning or implementing — this signals to teammates the issue is owned, so they don't double-pick it up.
5. **Update issue status** when completing: `mcp__linear-server__update_issue`
6. **Add completion comment** (see [format below](#completion-comment-format))

## Creating Issues

When creating issues with `mcp__linear-server__create_issue`, add the `claude code` label. Reason: the label is how the team filters/audits AI-generated issues; without it those issues vanish into the general backlog and the team loses visibility into AI contribution patterns.

## Language

Match the issue language to the conversation that produced it — if you're discussing in 中文，write the issue in 中文；if discussing in English, write it in English. Reason: the issue is a continuation of the conversation, and forcing a language switch creates translation friction for the collaborator who started the thread.

Specifics:

- 中文 conversation → 中文 body; technical terms (file paths, identifiers, library names, commands, error messages) stay in English.
- English conversation → English body.
- Code blocks, file paths, and quoted strings always stay in their original form regardless of surrounding language.
- This applies equally to **updates** — when editing an existing issue (description **and titles**), preserve the language of the conversation that triggered the edit; don't switch the issue language mid-refactor.

## Creating Sub-issue Trees

When breaking a parent issue into a tree of sub-issues (e.g., task decomposition for LOBE-xxx), follow these rules — they work around real limitations of the Linear MCP tools.

### 1. Prefix titles with an ordering index

The Linear Sub-issues panel orders children by `sortOrder`, which **defaults to newest-first** (most recently created appears on top). Neither parallel nor serial creation produces the intended top-to-bottom reading order, and the MCP `save_issue` tool does **not expose a `sortOrder` parameter** — you can't set order at create time.

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

Use `parentId: "LOBE-xxxx"` at creation (or `save_issue` to move). Moving an issue's parent does not disturb its `blockedBy` relations.

### 3. Sub-issue creation order is dictated by `blockedBy`

`blockedBy` requires the blocker to exist first (you need its LOBE-id). So:

1. **Topologically sort** the DAG — leaves (no deps) first, roots last
2. Create issues with zero deps in the first wave
3. Create dependent issues only after collecting the blocker IDs from prior responses
4. `blockedBy` is **append-only**; passing it again does not overwrite — safe to re-run

### 4. Don't waste rounds trying to parallelize

MCP tool calls in a single message look parallel but execute sequentially on the server, and you still need blocker IDs from earlier responses. Just issue calls in dependency order; optimizing for parallelism gains nothing here.

### 5. Keep each sub-issue description self-contained

Each sub-issue should state:

- Goal (1–2 lines)
- Key files to touch
- Concrete changes / acceptance criteria
- Dependencies (link to blocker issues by `LOBE-xxxx`)
- Validation steps

The implementer may open only the sub-issue, not the parent — don't rely on context that lives only in the parent description.

## Completion Comment Format

Each completed issue gets a comment summarizing the work, so reviewers and future readers don't have to reconstruct it from the PR diff:

```markdown
## Changes Summary

- **Feature**: Brief description of what was implemented
- **Files Changed**: List key files modified
- **PR**: #xxx or PR URL

### Key Changes

- Change 1
- Change 2
- ...
```

This gives team visibility, code-review context, and a paper trail for future reference.

## PR Association

When creating PRs for Linear issues, include magic keywords in the PR body:

- `Fixes LOBE-123`
- `Closes LOBE-123`
- `Resolves LOBE-123`

These trigger Linear's auto-link + auto-close on merge.

## Per-Issue Completion Rule

When working on multiple issues, close out **each one before starting the next** — don't batch all the Linear updates to the end. Batching is where comments get forgotten and issues stay stuck in "In Progress" days after the PR shipped.

For each issue:

1. Complete implementation
2. Run `bun run type-check`
3. Run related tests
4. Create PR if needed
5. Update status to **"In Review"** (not "Done" — "Done" is for after the PR merges)
6. Add the completion comment
7. Move to the next issue
