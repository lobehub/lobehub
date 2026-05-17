---
name: project-overview
description: Complete project architecture and structure guide. Use when exploring the codebase, understanding project organization, finding files, or needing comprehensive architectural context. Triggers on architecture questions, directory navigation, or project overview needs.
user-invocable: false
---

# LobeHub Project Overview

> The directory listings below are a **curated map of key locations**, not an
> exhaustive tree. `packages/`, `src/store/`, route groups etc. grow over time —
> run `ls` against the real directory for the current set.

## Project Description

Open-source, modern-design AI Agent Workspace: **LobeHub** (previously LobeChat).

**Supported platforms:**

- Web desktop/mobile
- Desktop (Electron)
- Mobile app (React Native) — **separate repo, already launched** (not in this monorepo)

**Logo emoji:** 🤯

## Complete Tech Stack

| Category      | Technology                                 |
| ------------- | ------------------------------------------ |
| Framework     | Next.js 16 + React 19                      |
| Routing       | SPA inside Next.js with `react-router-dom` |
| Language      | TypeScript                                 |
| UI Components | `@lobehub/ui`, antd                        |
| CSS-in-JS     | antd-style                                 |
| Icons         | lucide-react, `@ant-design/icons`          |
| i18n          | react-i18next                              |
| State         | zustand                                    |
| URL Params    | nuqs                                       |
| Data Fetching | SWR                                        |
| React Hooks   | aHooks                                     |
| Date/Time     | dayjs                                      |
| Utilities     | es-toolkit                                 |
| API           | TRPC (type-safe)                           |
| Database      | Neon PostgreSQL + Drizzle ORM              |
| Testing       | Vitest                                     |

> Exact versions live in the root `package.json` — check there, not here.

## Monorepo Layout

This is a monorepo extending the open-source `lobehub` submodule. Two repos:

- **cloud repo root** — `src/` and `packages/business/` (`config`, `const`, `model-runtime`) hold cloud-only SaaS code that overrides/extends the submodule. See `AGENTS.md` for the override mechanism.
- **`lobehub/` submodule** — the open-source product core.

### `lobehub/` submodule — key directories

```
lobehub/
├── apps/
│   ├── cli/                 # LobeHub CLI
│   ├── desktop/             # Electron desktop app
│   └── device-gateway/      # Device gateway service
├── docs/                    # changelog, development, self-hosting, usage
├── locales/                 # en-US, zh-CN, ...
├── packages/                # ~80 @lobechat/* workspace packages — `ls` for the full set. Key ones:
│   ├── agent-runtime/        # Agent runtime
│   ├── agent-signal/         # Agent Signal pipeline
│   ├── builtin-tool-*/       # Builtin tool packages
│   ├── builtin-tools/        # Builtin tool registries
│   ├── context-engine/
│   ├── database/             # src/{models,schemas,repositories}
│   ├── model-bank/           # Model definitions & provider cards
│   ├── model-runtime/        # src/{core,providers}
│   ├── types/
│   └── utils/
└── src/
    ├── app/
    │   ├── (backend)/        # api, f, market, middleware, oidc, trpc, webapi
    │   ├── spa/              # SPA HTML template service
    │   └── [variants]/(auth)/ # Auth pages (SSR required)
    ├── routes/               # SPA page segments (thin — delegate to features/)
    │   └── (main)/ (mobile)/ (desktop)/ (popup)/ onboarding/ share/
    ├── spa/                  # SPA entries + router config
    │   ├── entry.{web,mobile,desktop,popup}.tsx
    │   └── router/
    ├── business/             # Open-source stubs (~50) overridden by cloud src/business/
    ├── features/             # Domain business components
    ├── store/                # ~28 zustand stores — `ls` for the full set
    ├── server/               # featureFlags, globalConfig, modules, routers, services
    └── ...                   # components, hooks, layout, libs, locales, services, types, utils
```

### cloud repo — key directories

```
(cloud root)
├── packages/business/        # Cloud overrides: config, const, model-runtime
├── src/
│   ├── business/             # Cloud impls of submodule stubs (client/server/locales)
│   ├── routes/               # Cloud-only route groups: (cloud)/, embed/
│   ├── store/                # Cloud-only stores (e.g. subscription/)
│   ├── server/               # Cloud routers & services (billing, budget, risk control...)
│   └── app/(backend)/cron/   # Vercel cron routes (schedules declared in root vercel.ts)
└── vercel.ts                 # Cron schedule declarations
```

> File search rule: a path like `@/store/x` resolves cloud `src/store/x` first, then
> `lobehub/packages/store/src/x`, then `lobehub/src/store/x`. Cloud override wins.

## Architecture Map

| Layer            | Location                                             |
| ---------------- | ---------------------------------------------------- |
| UI Components    | `src/components`, `src/features`                     |
| SPA Pages        | `src/routes/`                                        |
| React Router     | `src/spa/router/`                                    |
| Global Providers | `src/layout`                                         |
| Zustand Stores   | `src/store`                                          |
| Client Services  | `src/services/`                                      |
| REST API         | `src/app/(backend)/webapi`                           |
| tRPC Routers     | `src/server/routers/{async\|lambda\|mobile\|tools}`  |
| Server Services  | `src/server/services` (can access DB)                |
| Server Modules   | `src/server/modules` (no DB access)                  |
| Feature Flags    | `src/server/featureFlags`                            |
| Global Config    | `src/server/globalConfig`                            |
| DB Schema        | `packages/database/src/schemas`                      |
| DB Model         | `packages/database/src/models`                       |
| DB Repository    | `packages/database/src/repositories`                 |
| Third-party      | `src/libs` (analytics, oidc, etc.)                   |
| Builtin Tools    | `src/tools`, `packages/builtin-tool-*`               |
| Cloud-only       | `src/business/*`, `packages/business/*` (cloud repo) |

## Data Flow

```
React UI → Store Actions → Client Service → TRPC Lambda → Server Services → DB Model → PostgreSQL
```
