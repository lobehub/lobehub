# LobeChat Development Guidelines

This document serves as a comprehensive guide for all team members when developing LobeChat.

## Project Description

You are developing an open-source, modern-design AI Agent Workspace: LobeHub(previous LobeChat).

## Tech Stack

Built with modern technologies:

- **Frontend**: Next.js 16, React 19, TypeScript
- **UI Components**: Ant Design, @lobehub/ui, antd-style
- **State Management**: Zustand, SWR
- **Database**: PostgreSQL, PGLite, Drizzle ORM
- **Testing**: Vitest, Testing Library
- **Package Manager**: pnpm (monorepo structure)

## Directory Structure

The project follows a well-organized monorepo structure:

- `apps/` - Main applications
- `packages/` - Shared packages and libraries
- `src/` - Main source code
- `docs/` - Documentation
- `.cursor/rules/` - Development rules and guidelines
- PR titles starting with `✨ feat/` or `🐛 fix` will trigger the release workflow upon merge. Only use these prefixes for significant user-facing feature changes or bug fixes

## Development Workflow

### Git Workflow

- The current release branch is `next` instead of `main` until v2.0.0 is officially released
- Use rebase for git pull
- Git commit messages should prefix with gitmoji
- Git branch name format: `username/feat/feature-name`
- Use `.github/PULL_REQUEST_TEMPLATE.md` for PR descriptions

### Package Management

- Use `pnpm` as the primary package manager
- Use `bun` to run npm scripts
- Use `bunx` to run executable npm packages

### Code Style Guidelines

#### TypeScript

- Prefer interfaces over types for object shapes

### Testing Strategy

**Required Rule**: `testing-guide/testing-guide.mdc`

**Commands**:

- Web: `bunx vitest run --silent='passed-only' '[file-path-pattern]'`
- Packages: `cd packages/[package-name] && bunx vitest run --silent='passed-only' '[file-path-pattern]'` (each subpackage contains its own vitest.config.mts)

**Important Notes**:

- Wrap file paths in single quotes to avoid shell expansion
- Never run `bun run test` - this runs all tests and takes \~10 minutes

### Type Checking

- Use `bun run type-check` to check for type errors

### i18n

- **Keys**: Add to `src/locales/default/namespace.ts`
- **Dev**: Translate `locales/zh-CN/namespace.json` locale file only for preview
- DON'T run `pnpm i18n`, let CI auto handle it

## Linear Issue Management

Follow [Linear rules in CLAUDE.md](CLAUDE.md#linear-issue-management-ignore-if-not-installed-linear-mcp) when working with Linear issues.

## Project Rules Index

All following rules are saved under `.cursor/rules/` directory:

### Backend

- `drizzle-schema-style-guide.mdc` – Style guide for defining Drizzle ORM schemas

### Frontend

- `react.mdc` – React component style guide and conventions
- `i18n.mdc` – Internationalization guide using react-i18next
- `typescript.mdc` – TypeScript code style guide
- `packages/react-layout-kit.mdc` – Usage guide for Flexbox and Center components from @lobehub/ui

### State Management

- `zustand-action-patterns.mdc` – Recommended patterns for organizing Zustand actions
- `zustand-slice-organization.mdc` – Best practices for structuring Zustand slices

### Desktop (Electron)

- `desktop-feature-implementation.mdc` – Implementing new Electron desktop features
- `desktop-controller-tests.mdc` – Desktop controller unit testing guide
- `desktop-local-tools-implement.mdc` – Workflow to add new desktop local tools
- `desktop-menu-configuration.mdc` – Desktop menu configuration guide
- `desktop-window-management.mdc` – Desktop window management guide

### Debugging

- `debug-usage.mdc` – Using the debug package and namespace conventions

### Testing

- `testing-guide/testing-guide.mdc` – Comprehensive testing guide for Vitest
- `testing-guide/electron-ipc-test.mdc` – Electron IPC interface testing strategy
- `testing-guide/db-model-test.mdc` – Database Model testing guide
