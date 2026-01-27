# GEMINI.md

Guidelines for using Gemini CLI in this LobeChat repository.

## Tech Stack

- Next.js 16 + React 19 + TypeScript
- SPA inside Next.js with `react-router-dom`
- `@lobehub/ui`, antd for components; antd-style for CSS-in-JS
- react-i18next for i18n; zustand for state management
- SWR for data fetching; TRPC for type-safe backend
- Drizzle ORM with PostgreSQL; Vitest for testing

## Project Structure

```
lobe-chat/
├── apps/desktop/           # Electron desktop app
├── packages/               # Shared packages (@lobechat/*)
│   ├── database/           # Database schemas, models, repositories
│   ├── agent-runtime/      # Agent runtime
│   └── ...
├── src/
│   ├── app/                # Next.js app router
│   ├── store/              # Zustand stores
│   ├── services/           # Client services
│   ├── server/             # Server services and routers
│   └── ...
└── e2e/                    # E2E tests (Cucumber + Playwright)
```

## Development

### Git Workflow

- Use rebase for `git pull`
- Commit messages: prefix with gitmoji
- Branch format: `<type>/<feature-name>`
- PR titles with `✨ feat/` or `🐛 fix` trigger releases

### Package Management

- `pnpm` for dependency management
- `bun` to run npm scripts
- `bunx` for executable npm packages

### Testing

```bash
# Run specific test (NEVER run `bun run test` - takes ~10 minutes)
bunx vitest run --silent='passed-only' '[file-path]'

# Database package
cd packages/database && bunx vitest run --silent='passed-only' '[file]'
```

- Tests must pass type check: `bun run type-check`
- After 2 failed fix attempts, stop and ask for help

### i18n

- Add keys to `src/locales/default/namespace.ts`
- For dev preview: translate `locales/zh-CN/` and `locales/en-US/`
- Don't run `pnpm i18n` - CI handles it

## Quality Checks

**MANDATORY**: After completing code changes, run diagnostics on modified files to identify and fix any errors.

## Skills (Auto-loaded)

Skills are available in `.agents/skills/` directory. See CLAUDE.md for the full list.
