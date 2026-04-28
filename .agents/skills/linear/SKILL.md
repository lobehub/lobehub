---
name: linear
description: "Linear issue management. MUST USE when: (1) user mentions LOBE-xxx issue IDs (e.g. LOBE-4540), (2) user says 'linear', 'linear issue', 'link linear', (3) creating PRs that reference Linear issues. Provides workflows for retrieving issues, updating status, and adding comments."
---

# Linear Issue Management

Before using Linear workflows, search for `linear` MCP tools. If not found, treat as not installed.

## ⚠️ CRITICAL: PR Creation with Linear Issues

**When creating a PR that references Linear issues (LOBE-xxx), you MUST:**

1. Create the PR with magic keywords (`Fixes LOBE-xxx`)
2. **IMMEDIATELY after PR creation**, add completion comments to ALL referenced Linear issues
3. Do NOT consider the task complete until Linear comments are added

This is NON-NEGOTIABLE. Skipping Linear comments is a workflow violation.

## Workflow

1. **Retrieve issue details** before starting: `mcp__linear-server__get_issue`
2. **Read images**: If the issue description contains images, MUST use `mcp__linear-server__extract_images` to read image content for full context
3. **Check for sub-issues**: Use `mcp__linear-server__list_issues` with `parentId` filter
4. **Mark as In Progress**: When starting to plan or implement an issue, immediately update status to **"In Progress"** via `mcp__linear-server__update_issue`
5. **Update issue status** when completing: `mcp__linear-server__update_issue`
6. **Add completion comment** (REQUIRED): `mcp__linear-server__create_comment`

## Creating Issues

When creating issues with `mcp__linear-server__create_issue`, **MUST add the `claude code` label**.

## Creating Sub-issue Trees

When breaking a parent issue into a tree of sub-issues (e.g., task decomposition for LOBE-xxx), follow these rules — they work around real limitations of the Linear MCP tools.

### 1. ALWAYS prefix titles with an ordering index

The Linear Sub-issues panel displays children by `sortOrder`, which **defaults to newest-first** (most recently created appears on top). Neither parallel nor serial creation will produce the intended top-to-bottom reading order, and the MCP `save_issue` tool does **not expose a `sortOrder` parameter** — you cannot set order at create time.

**Workaround**: encode execution order in the title itself:

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

Every completed issue MUST have a comment summarizing work done:

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

This is critical for:

- Team visibility
- Code review context
- Future reference

## PR Association (REQUIRED)

When creating PRs for Linear issues, include magic keywords in PR body:

- `Fixes LOBE-123`
- `Closes LOBE-123`
- `Resolves LOBE-123`

## Per-Issue Completion Rule

When working on multiple issues, update EACH issue IMMEDIATELY after completing it:

1. Complete implementation
2. Run `bun run type-check`
3. Run related tests
4. Create PR if needed
5. Update status to **"In Review"** (NOT "Done")
6. **Add completion comment immediately**
7. Move to next issue

**Note:** Status → "In Review" when PR created. "Done" only after PR merged.

**❌ Wrong:** Complete all → Create PR → Forget Linear comments

**✅ Correct:** Complete → Create PR → Add Linear comments → Task done
