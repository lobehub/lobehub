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
2. **Check for sub-issues**: Use `mcp__linear-server__list_issues` with `parentId` filter
3. **Update issue status** when completing: `mcp__linear-server__update_issue`
4. **Add completion comment** (REQUIRED): `mcp__linear-server__create_comment`

## Creating Issues

When creating issues with `mcp__linear-server__create_issue`, **MUST add the `claude code` label**.

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
