# LobeHub Development Guidelines

Guidelines for using AI coding agents in this opensource LobeHub repository.

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
│   └── server/             # Server service
├── packages/               # Shared packages (@lobechat/*)
│   ├── database/           # Database schemas, models, repositories
│   ├── agent-runtime/      # Agent runtime
│   ├── locales/            # i18n source: packages/locales/src/default/
│   ├── env/                # env schemas (@/envs/* → packages/env/src/*)
│   └── ...
├── src/
│   ├── app/                # Next.js App Router (backend API + auth shell)
│   │   ├── (backend)/      # API routes (trpc, webapi, etc.)
│   │   ├── spa/            # SPA HTML template service
│   │   └── spa-auth/       # Auth HTML shell (SSR)
│   ├── routes/             # SPA page segments (thin — delegate to features/)
│   │   ├── (main)/ (mobile)/ (desktop)/ (popup)/
│   │   ├── auth/           # Auth page segments (signin, signup, …)
│   │   ├── onboarding/ share/
│   ├── spa/                # SPA entry points and router config
│   │   ├── entry.{web,mobile,desktop,popup}.tsx
│   │   └── router/         # React Router configuration
│   ├── store/              # Zustand stores
│   ├── services/           # Client services
│   ├── server/             # standalone-Hono pieces only (main backend: apps/server)
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

See the **spa-routes** skill for the full convention and file-division rules.

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

### Quality Check

```bash
bun run check [changed-files...]
```

- No selector = **lint + test in a single pass** — run it once; don't fire a separate pass per selector. `--lint` / `--test` / `--type` narrow scope and are composable within one run. Default files = all working-tree changes (staged + unstaged + untracked); explicit paths override.
- `--lint` auto-fixes the given files and prints the applied fixes as a diff, so you can review what changed.
- `--test` auto-discovers the related tests for the given source files and runs them under the nearest owning vitest config (e.g. `packages/database`) — no need to `cd` into packages.
- `--type` runs the full type-check. NEVER run `bun run test` — the full suite takes \~10 minutes.
- To run tests manually (e.g. a single file or unusual flags), `cd` into the owning package first: `cd packages/database && bunx vitest run --silent='passed-only' '[file-path]'`.

### i18n

- Add keys to a namespace file under `packages/locales/src/default/` (e.g. `agent.ts`, `auth.ts`)
- Hand-write en-US + zh-CN for dev preview: author the English source in `packages/locales/src/default/*.ts`, mirror it to `locales/en-US/`, and hand-translate `locales/zh-CN/`.
- Before opening the PR, run `bun run i18n` (slow) to fill the remaining locales with the script — don't hand-translate those.

### Code Style

- When a single file grows beyond \~800 lines, consider splitting it into multiple files (extract sub-components, hooks, helpers, or types). Smaller, focused files are friendly to humans and agents.

### Code Review

Before reviewing a PR / diff / branch change, read the **deep-review** skill. Ordinary review requests use its light mode (inline review against the dimension quick checklists); the full multi-subagent deep mode runs only on explicit invocation.

When designing or reviewing user-facing flows (empty/loading/error states, confirmations, async feedback, button hierarchy, lists at scale, pickers), follow LobeHub's design values in [`DESIGN.md`](./DESIGN.md) — Natural / Meaningful / Certainty / Growth (自然 / 意义感 / 确定性 / 成长).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

**Keep this block, including in commits.** It is part of the project's agent setup, maintained by `next dev` for every agent that works here. If it appears as an uncommitted change, that is intentional — commit it as-is. Do not remove it to clean up a diff; it will be regenerated.

<!-- END:nextjs-agent-rules -->
