# LobeHub Development Guidelines

Guidelines for using AI coding agents in this LobeHub repository.

## Tech Stack

- Next.js 16 + React 19 + TypeScript
- SPA inside Next.js with `react-router-dom`
- `@lobehub/ui`, antd for components; antd-style for CSS-in-JS — **prefer `createStaticStyles` with `cssVar.*`** (zero-runtime); only fall back to `createStyles` + `token` when styles genuinely need runtime computation. See `.cursor/docs/createStaticStyles_migration_guide.md`.
- **Component priority**: `@lobehub/ui/base-ui` (headless primitives) **first**, then `@lobehub/ui` root, then antd as last resort. When the component exists in base-ui, use it — never reach for the root or antd counterpart. Base-ui covers `Select`, `Modal` / `createModal` / `confirmModal`, `DropdownMenu`, `ContextMenu`, `Popover`, `ScrollArea`, `Switch`, `Toast`, `FloatingSheet`. Prefer `@lobehub/ui/base-ui` for new code and migrate root-package call sites opportunistically.
- react-i18next for i18n; zustand for state management
- SWR for data fetching; TRPC for type-safe backend
- Drizzle ORM with PostgreSQL; Vitest for testing

## Project Structure

```plaintext
lobehub/
├── apps/
│   ├── desktop/            # Electron desktop app
│   ├── cli/                # LobeHub CLI
│   └── device-gateway/     # Device gateway service
├── packages/               # Shared packages (@lobechat/*)
│   ├── database/           # Database schemas, models, repositories
│   ├── agent-runtime/      # Agent runtime
│   └── ...
├── src/
│   ├── app/                # Next.js App Router (backend API + auth)
│   │   ├── (backend)/     # API routes (trpc, webapi, etc.)
│   │   ├── spa/            # SPA HTML template service
│   │   └── [variants]/(auth)/  # Auth pages (SSR required)
│   ├── routes/             # SPA page components (Vite)
│   │   ├── (main)/         # Desktop pages
│   │   ├── (mobile)/       # Mobile pages
│   │   ├── (desktop)/      # Desktop-specific pages
│   │   ├── (popup)/        # Popup window pages
│   │   ├── onboarding/     # Onboarding pages
│   │   └── share/          # Share pages
│   ├── spa/                # SPA entry points and router config
│   │   ├── entry.web.tsx   # Web entry
│   │   ├── entry.mobile.tsx
│   │   ├── entry.desktop.tsx
│   │   ├── entry.popup.tsx
│   │   └── router/         # React Router configuration
│   ├── store/              # Zustand stores
│   ├── services/           # Client services
│   ├── server/             # Server services and routers
│   └── ...
└── e2e/                    # E2E tests (Cucumber + Playwright)
```

## SPA Routes and Features

SPA-related code is grouped under `src/spa/` (entries + router) and `src/routes/` (page segments). We use a **roots vs features** split: route trees only hold page segments; business logic and UI live in features.

- **`src/spa/`** – SPA entry points (`entry.web.tsx`, `entry.mobile.tsx`, `entry.desktop.tsx`, `entry.popup.tsx`) and React Router config (`router/`, with `desktopRouter.config.*`, `mobileRouter.config.tsx`, `popupRouter.config.tsx`). Keeps router config next to entries to avoid confusion with `src/routes/`.

- **`src/routes/` (roots)**\
  Only page-segment files: `_layout/index.tsx`, `index.tsx` (or `page.tsx`), and dynamic segments like `[id]/index.tsx`. Keep these **thin**: they should only import from `@/features/*` and compose layout/page, with no business logic or heavy UI.

- **`src/features/`**\
  Business components by **domain** (e.g. `Pages`, `PageEditor`, `Home`). Put layout chunks (sidebar, header, body), hooks, and domain-specific UI here. Each feature exposes an `index.ts` (or `index.tsx`) with clear exports.

When adding or changing SPA routes:

1. In `src/routes/`, add only the route segment files (layout + page) that delegate to features.
2. Implement layout and page content under `src/features/<Domain>/` and export from there.
3. In route files, use `import { X } from '@/features/<Domain>'` (or `import Y from '@/features/<Domain>/...'`). Do not add new `features/` folders inside `src/routes/`.
4. **Register the desktop route tree in both configs:** `src/spa/router/desktopRouter.config.tsx` and `src/spa/router/desktopRouter.config.desktop.tsx` must stay in sync (same paths and nesting). Updating only one can cause **blank screens** if the other build path expects the route. `desktopRouter.sync.test.tsx` guards this invariant — keep it passing.

See the **spa-routes** skill (`.agents/skills/spa-routes/SKILL.md`) for the full convention and file-division rules.

## Development

### Starting the Dev Environment

```bash
# SPA dev mode (frontend only, proxies API to localhost:3010)
bun run dev:spa

# Full-stack dev (Next.js + Vite SPA concurrently)
bun run dev
```

After `dev:spa` starts, the terminal prints a **Debug Proxy** URL:

```plaintext
Debug Proxy: https://app.lobehub.com/_dangerous_local_dev_proxy?debug-host=http%3A%2F%2Flocalhost%3A9876
```

Open this URL to develop locally against the production backend (app.lobehub.com). The proxy page loads your local Vite dev server's SPA into the online environment, enabling HMR with real server config.

### Git Workflow

- **Branch strategy**: `canary` is the development branch (cloud production); `main` is the release branch (periodically cherry-picks from canary)
- New branches should be created from `canary`; PRs should target `canary`
- Use rebase for `git pull`
- Commit messages: prefix with gitmoji
- Branch format: `<type>/<feature-name>`

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

- Prefer `vi.spyOn` over `vi.mock`

### Type Checking

```bash
bun run type-check
```

### i18n

- Add keys to a namespace file under `src/locales/default/` (e.g. `agent.ts`, `auth.ts`)
- For dev preview: translate `locales/zh-CN/` and `locales/en-US/`
- `pnpm i18n` is slow; run it manually when locale keys need updating (e.g. before opening a PR).

### Code Style

- When a single file grows beyond \~800 lines, consider splitting it into multiple files (extract sub-components, hooks, helpers, or types). Smaller, focused files are friendly to humans and agents.

### Code Review

Before reviewing a PR / diff / branch change, read the **review-checklist** skill (`.agents/skills/review-checklist/SKILL.md`) — it lists the recurring mistakes specific to this codebase.

<!-- gortex:communities:start -->

<!-- gortex:skills:start -->

## Community Skills

| Area                             | Description | Skill                                      |
| -------------------------------- | ----------- | ------------------------------------------ |
| Src Transformation 60 Dirs       | 462 symbols | `/gortex-src-transformation-60-dirs`       |
| Platforms Telegram 60 Dirs       | 263 symbols | `/gortex-platforms-telegram-60-dirs`       |
| Providers Tests 7 Dirs           | 241 symbols | `/gortex-providers-tests-7-dirs`           |
| Libs Redis 14 Dirs               | 222 symbols | `/gortex-libs-redis-14-dirs`               |
| Src Commands 3 Dirs              | 207 symbols | `/gortex-src-commands-3-dirs`              |
| Services Agentruntime 8 Dirs     | 202 symbols | `/gortex-services-agentruntime-8-dirs`     |
| Models Agentdocuments 6 Dirs     | 185 symbols | `/gortex-models-agentdocuments-6-dirs`     |
| Chat Adapter Feishu Src 3 Dirs   | 177 symbols | `/gortex-chat-adapter-feishu-src-3-dirs`   |
| Types Src 29 Dirs                | 156 symbols | `/gortex-types-src-29-dirs`                |
| Services Agentdocumentvfs 3 Dirs | 153 symbols | `/gortex-services-agentdocumentvfs-3-dirs` |
| Platforms Telegram Call          | 153 symbols | `/gortex-platforms-telegram-call`          |
| Services Bot Registerhandlers    | 149 symbols | `/gortex-services-bot-registerhandlers`    |
| Src Spawn 9 Dirs                 | 149 symbols | `/gortex-src-spawn-9-dirs`                 |
| Src Models 10 Dirs               | 145 symbols | `/gortex-src-models-10-dirs`               |
| Modules Agentruntime 5 Dirs      | 143 symbols | `/gortex-modules-agentruntime-5-dirs`      |
| Server Services Call             | 138 symbols | `/gortex-server-services-call`             |
| Src Utils 4 Dirs                 | 125 symbols | `/gortex-src-utils-4-dirs`                 |
| Core Infrastructure 9 Dirs       | 122 symbols | `/gortex-core-infrastructure-9-dirs`       |
| Server Services Renameskill      | 120 symbols | `/gortex-server-services-renameskill`      |
| Services Agentdocuments 6 Dirs   | 117 symbols | `/gortex-services-agentdocuments-6-dirs`   |

<!-- gortex:skills:end -->

<!-- gortex:communities:end -->

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **lobehub-canary** (105267 symbols, 176097 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource                                        | Use for                                  |
| ----------------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/lobehub-canary/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/lobehub-canary/clusters`       | All functional areas                     |
| `gitnexus://repo/lobehub-canary/processes`      | All execution flows                      |
| `gitnexus://repo/lobehub-canary/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->
