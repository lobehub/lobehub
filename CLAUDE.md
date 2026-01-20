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

### Code Comments

- **Avoid meaningless comments**: Do not write comments that merely restate what the code does. Comments should explain _why_ something is done, not _what_ is being done. The code itself should be self-explanatory.

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

## Linear Issue Management(ignore if not installed linear mcp)

Read @.cursor/rules/linear.mdc when working with Linear issues.

## Rules Index

Some useful project rules are listed in @.cursor/rules/rules-index.mdc
