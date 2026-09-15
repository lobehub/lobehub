# LobeHub Development Guidelines

Guidelines for using AI coding agents in this opensource LobeHub repository.

## Tech Stack

- Next.js 16 + React 19 + TypeScript
- SPA inside Next.js with `react-router-dom`
- `@lobehub/ui`, antd, and antd-style for UI implementation
- react-i18next for i18n; zustand for state management
- SWR for data fetching; TRPC for type-safe backend
- Drizzle ORM with PostgreSQL; Vitest for testing

## Agent Skills

`AGENTS.md` owns repository-wide architecture and workflow. Keep detailed implementation rules in skills so they have one source of truth.

- **React and TSX**: Before editing components, component state, render boundaries, or memoization, read the `react` skill. It owns component selection, styling, state locality, and render-performance rules.
- **Heavy domain features**: When splitting a fat Viewer/Page into reusable pieces (page vs portal vs share vs micro-app), read the `compose-atoms` skill. Split on mountable capabilities, not visual sections, and do not hide unused work behind `readOnly` / `mode` flags.

## Code Ownership

For the full repository map or help locating a code layer, read the `project-overview` skill.

- `apps/server/src`: backend runtime, routers, and services, imported through `@/server/*`. `src/app/(backend)` contains Next.js route shells only; do not put backend business logic there.
- `src/app`: Next.js HTML/auth shells. Web shell helpers belong under `src/libs` or the relevant app segment, not `src/server`.
- `src/spa`: SPA entry points and React Router configuration. `src/routes` holds thin page segments that compose `src/features`; business UI and logic belong in features by domain.
- `src/services` and `src/store`: client API services and Zustand state. Keep fetch/cache guidance in `data-fetching-architecture` and store conventions in `zustand`.
- `apps/desktop`, `apps/cli`: Electron and CLI applications. `packages` holds shared code, including `database`, `agent-runtime`, `env`, and `locales`.
- `e2e`: end-to-end tests using Cucumber and Playwright.

Before changing SPA routes, read the `spa-routes` skill. Register common Web/Electron paths, metadata, lazy loaders and `preloadId` values once in `src/spa/router/desktopRouter.shared.tsx`; keep `desktopRouter.config*.tsx` limited to platform differences and `desktopRouter.sync.test.tsx` passing. Do not create `features` directories inside `src/routes`.

## Development

### Starting the Dev Environment

```bash
# SPA dev mode (frontend only, proxies API to localhost:3010)
bun run dev:spa

# Full-stack dev (Next.js + Vite SPA concurrently)
bun run dev

# Standalone Hono backend service
pnpm --filter @lobechat/server dev
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

Use `bun run check [changed-files...]`.

- Every bug fix needs a regression test that fails before the fix and passes after it. Skip pure style/CSS fixes when the only practical assertion would match stylesheet source strings.
- Run once with the selectors needed: no selector means lint + related tests; `--lint`, `--test`, and `--type` compose. Default scope is all staged, unstaged and untracked changes; explicit paths override it.
- Lint autofixes files: review the emitted diff. Tests use the nearest owning Vitest config. `--type` checks the full repo. Never run `bun run test`, which runs the full suite.
- For a manual package test, run from the owning package: `cd packages/database && bunx vitest run --silent='passed-only' '[file-path]'`.

### Acceptance

Use the `acceptance` skill to decide whether the delivery needs product verification and whether existing evidence already covers it. Opening or marking a PR ready is a checkpoint for that decision, not a trigger to rerun verification.

- Documentation/instruction-only changes, pure refactors or tooling changes with no product behavior change, and gitlink-only syncs do not require a new acceptance run. State the reason in the PR; for a gitlink sync, link the upstream change and its existing acceptance when available.
- Reuse a completed acceptance that covers the delivered behavior. If its report and evidence exist only locally, inspect and upload them with `lh acceptance run ingest`; if already published, reuse the link. Do not rerun the product merely to open a PR or obtain a report URL.
- For new or changed product behavior not covered by valid evidence, verify the affected outcomes on the real product, capture the required evidence, and publish the result. The skill owns reuse criteria and the execution workflow.

When acceptance is required, put its published `https://app.lobehub.com/acceptance/<id>` link in the PR body. Tests, lint, and type-check remain separate quality gates; they do not replace product acceptance.

### i18n

- Add keys to a namespace file under `packages/locales/src/default/` (e.g. `agent.ts`, `auth.ts`)
- Ship en-US and zh-CN by hand in the same PR: author the English source in `packages/locales/src/default/*.ts`, mirror it to `locales/en-US/`, and hand-translate `locales/zh-CN/`.
- Leave all other locales to the daily CI workflow (`.github/workflows/auto-i18n.yml`), which runs `bun run i18n` and opens an automated translation PR. Missing locale keys fall back to English until that PR is merged.
- Run `bun run i18n` manually only when the translated locales are needed immediately instead of waiting for the daily workflow. It is slow and requires `OPENAI_API_KEY`; don't hand-translate the generated locales.

### Code Style

- When a single file grows beyond \~800 lines, consider splitting it into multiple files (extract sub-components, hooks, helpers, or types). Smaller, focused files are friendly to humans and agents.

### Code Review

Before reviewing a PR / diff / branch change, read the **deep-review** skill. Ordinary review requests use its light mode (one independent reviewer against the dimension quick checklists); the full multi-subagent deep mode runs only on explicit invocation.

When designing or reviewing user-facing flows (empty/loading/error states, confirmations, async feedback, button hierarchy, lists at scale, pickers), follow LobeHub's design values in [`DESIGN.md`](./DESIGN.md) — Natural / Meaningful / Certainty / Growth (自然 / 意义感 / 确定性 / 成长).
