# GEMINI.md

This document serves as a shared guideline for all team members when using Gemini CLI in this repository.

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

### Typecheck

- use `bun run type-check` to check type errors.

### i18n

- **Keys**: Add to `src/locales/default/namespace.ts`
- **Dev**: Translate `locales/zh-CN/namespace.json` and `locales/en-US/namespace.json` locales file only for dev preview
- DON'T run `pnpm i18n`, let CI auto handle it

## 🚨 Quality Checks

**MANDATORY**: After completing code changes, always run `mcp__vscode-mcp__get_diagnostics` on the modified files to identify any errors introduced by your changes and fix them.

## Rules Index

Some useful project rules are listed in @.cursor/rules/rules-index.mdc
