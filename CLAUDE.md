# CLAUDE.md

This document serves as a shared guideline for all team members when using Claude Code in this opensource lobe-chat(also known as lobehub) repository.

## Tech Stack

read @.cursor/rules/project-introduce.mdc

## Directory Structure

read @.cursor/rules/project-structure.mdc

## Development

### Git Workflow

- use rebase for git pull
- git commit message should prefix with gitmoji
- git branch name format template: <type>/<feature-name>
- use .github/PULL_REQUEST_TEMPLATE.md to generate pull request description
- PR titles starting with `✨ feat/` or `🐛 fix` will trigger the release workflow upon merge. Only use these prefixes for significant user-facing feature changes or bug fixes

### Package Management

This repository adopts a monorepo structure.

- Use `pnpm` as the primary package manager for dependency management
- Use `bun` to run npm scripts
- Use `bunx` to run executable npm packages

### TypeScript Code Style Guide

see @.cursor/rules/typescript.mdc

### Testing

- **Required Rule**: read `.cursor/rules/testing-guide/testing-guide.mdc` before writing tests
- **Command**:
  - web: `bunx vitest run --silent='passed-only' '[file-path-pattern]'`
  - packages(eg: database): `cd packages/database && bunx vitest run --silent='passed-only' '[file-path-pattern]'`

**Important**:

- wrap the file path in single quotes to avoid shell expansion
- Never run `bun run test` etc to run tests, this will run all tests and cost about 10mins
- If trying to fix the same test twice, but still failed, stop and ask for help.
- **Prefer `vi.spyOn` over `vi.mock`**: When mocking modules or functions, prefer using `vi.spyOn` to mock specific functions rather than `vi.mock` to mock entire modules. This approach is more targeted, easier to maintain, and allows for better control over mock behavior in individual tests.
- **Tests must pass type check**: After writing or modifying tests, run `bun run type-check` to ensure there are no type errors. Tests should pass both runtime execution and TypeScript type checking.

### Typecheck

- use `bun run type-check` to check type errors.

### i18n

- **Keys**: Add to `src/locales/default/namespace.ts`
- **Dev**: Translate `locales/zh-CN/namespace.json` and `locales/en-US/namespace.json` locales file only for dev preview
- DON'T run `pnpm i18n`, let CI auto handle it

## Linear Issue Management (ignore if not installed linear mcp)

When working with Linear issues:

1. **Retrieve issue details** before starting work using `mcp__linear-server__get_issue`
2. **Check for sub-issues**: If the issue has sub-issues, retrieve and review ALL sub-issues using `mcp__linear-server__list_issues` with `parentId` filter before starting work
3. **Update issue status** when completing tasks using `mcp__linear-server__update_issue`
4. **MUST add completion comment** using `mcp__linear-server__create_comment`

### Creating Issues

When creating new Linear issues using `mcp__linear-server__create_issue`, **MUST add the `claude code` label** to indicate the issue was created by Claude Code.

### Completion Comment (REQUIRED)

**Every time you complete an issue, you MUST add a comment summarizing the work done.** This is critical for:

- Team visibility and knowledge sharing
- Code review context
- Future reference and debugging

### PR Linear Issue Association (REQUIRED)

**When creating PRs for Linear issues, MUST include magic keywords in PR body:** `Fixes LOBE-123`, `Closes LOBE-123`, or `Resolves LOBE-123`, and summarize the work done in the linear issue comment and update the issue status to "In Review".

### IMPORTANT: Per-Issue Completion Rule

**When working on multiple issues (e.g., parent issue with sub-issues), you MUST update status and add comment for EACH issue IMMEDIATELY after completing it.** Do NOT wait until all issues are done to update them in batch.

**Workflow for EACH individual issue:**

1. Complete the implementation for this specific issue
2. Run type check: `bun run type-check`
3. Run related tests if applicable
4. Create PR if needed
5. **IMMEDIATELY** update issue status to **"In Review"** (NOT "Done"): `mcp__linear-server__update_issue`
6. **IMMEDIATELY** add completion comment: `mcp__linear-server__create_comment`
7. Only then move on to the next issue

**Note:** Issue status should be set to **"In Review"** when PR is created. The status will be updated to **"Done"** only after the PR is merged (usually handled by Linear-GitHub integration or manually).

**❌ Wrong approach:**

- Complete Issue A → Complete Issue B → Complete Issue C → Update all statuses → Add all comments
- Mark issue as "Done" immediately after creating PR

**✅ Correct approach:**

- Complete Issue A → Create PR → Update A status to "In Review" → Add A comment → Complete Issue B → ...

## Rules Index

Some useful project rules are listed in @.cursor/rules/rules-index.mdc
