---
name: linear
description: Linear issue management guide. Use when working with Linear issues, creating issues, updating status, or adding comments. Triggers on Linear issue references (LOBE-xxx), issue tracking, or project management tasks. Requires Linear MCP tools to be available.
---

# Linear Issue Management

Before using Linear workflows, search for `linear` MCP tools. If not found, treat as not installed.

## Workflow

1. **Retrieve issue details** before starting: `mcp__linear-server__get_issue`
2. **Check for sub-issues**: Use `mcp__linear-server__list_issues` with `parentId` filter
3. **Update issue status** when completing: `mcp__linear-server__update_issue`
4. **Add completion comment** (REQUIRED): `mcp__linear-server__create_comment`

## Creating Issues

When creating issues with `mcp__linear-server__create_issue`, **MUST add the `claude code` label**.

## Completion Comment (REQUIRED)

Every completed issue MUST have a comment summarizing work done. This is critical for:
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
6. Add completion comment
7. Move to next issue

**Note:** Status → "In Review" when PR created. "Done" only after PR merged.

**❌ Wrong:** Complete all → Update all statuses → Add all comments

**✅ Correct:** Complete A → Update A → Comment A → Complete B → ...
