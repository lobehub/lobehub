---
name: spa-routes
description: 'LobeHub SPA route architecture. Use when editing src/routes, src/features delegation, desktop/mobile/popup router configs, .desktop variants, route segments, redirects, or new pages.'
user-invocable: false
---

# SPA Routes and Features Guide

SPA structure:

- **`src/spa/`** – Entry points (`entry.web.tsx`, `entry.mobile.tsx`, `entry.desktop.tsx`) and router config (`router/`). Router lives here to avoid confusion with `src/routes/`.
- **`src/routes/`** – Page segments only (roots).
- **`src/features/`** – Business logic and UI by domain.

This project uses a **roots vs features** split: `src/routes/` only holds page segments; business logic and UI live in `src/features/` by domain.

**Agent constraint — shared desktop router:** Common Web/Electron paths, nesting, metadata, lazy loaders, and preload groups belong in `src/spa/router/desktopRouter.shared.tsx`. The two `desktopRouter.config*` files are thin platform adapters; change them only for genuine runtime differences. Do not duplicate a common route in both adapters.

## When to Use This Skill

- Adding a new SPA route or route segment
- Defining or refactoring layout/page files under `src/routes/`
- Moving route-specific components or logic into `src/features/`
- Deciding where to put a new component (route folder vs feature folder)

---

## 1. What Belongs in `src/routes/` (roots)

Each route directory should contain **only**:

| File / folder                                 | Purpose                                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `_layout/index.tsx` or `layout.tsx`           | Layout for this segment: wrap with `<Outlet />`, optional shell (e.g. sidebar + main). Should be thin: prefer re-exporting or composing from `@/features/*`. |
| `index.tsx` or `page.tsx`                     | Page entry for this segment. Only import from features and render; no business logic.                                                                        |
| `[param]/index.tsx` (e.g. `[id]`, `[cronId]`) | Dynamic segment page. Same rule: thin, delegate to features.                                                                                                 |

**Rule:** Route files should only **import and compose**. No new `features/` folders or heavy components inside `src/routes/`.

---

## 2. What Belongs in `src/features/`

Put **domain-oriented** UI and logic here:

- Layout building blocks: sidebars, headers, body panels, drawers
- Hooks and store usage for that domain
- Domain-specific forms, lists, modals, etc.

Organize by **domain** (e.g. `Pages`, `Home`, `Agent`, `PageEditor`), not by route path. One route can use several features; one feature can be used by several routes.

Each feature should:

- Live under `src/features/<FeatureName>/`
- Export a clear public API via `index.ts` or `index.tsx`
- Use `@/features/<FeatureName>/...` for internal imports when needed

---

## 3. How to Add a New SPA Route

1. **Choose the route group**
   - `(main)/` – desktop main app
   - `(mobile)/` – mobile
   - `(desktop)/` – Electron-specific
   - `onboarding/`, `share/` – special flows

2. **Create only segment files under `src/routes/`**
   - e.g. `src/routes/(main)/my-feature/_layout/index.tsx` and `src/routes/(main)/my-feature/index.tsx` (and optional `[id]/index.tsx`).

3. **Implement layout and page content in `src/features/`**
   - Create or reuse a domain (e.g. `src/features/MyFeature/`).
   - Put layout (sidebar, header, body) and page UI there; export from the feature’s `index`.

4. **Keep route files thin**
   - Layout: `export { default } from '@/features/MyFeature/MyLayout'` or compose a few feature components + `<Outlet />`.
   - Page: import from `@/features/MyFeature` (or a specific subpath) and render; no business logic in the route file.

5. **Register the route in the correct definition layer**
   - **Shared Web/Electron route:** add the segment once in `desktopRouter.shared.tsx` with `dynamicElement` / `dynamicLayout`. Put its `preloadId` there as part of the shared lazy-loader definition.
   - **Web-only or Electron-only route:** add it to the corresponding thin `desktopRouter.config.tsx` adapter. Keep platform-only differences explicit and small.
   - **Mobile-only flow:** use `mobileRouter.config.tsx`; mobile does not consume the shared desktop tree.

---

## 3a. Shared desktop route definition and platform adapters

| File                               | Role                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `desktopRouter.shared.tsx`         | Single source of truth for common paths, nesting, metadata, lazy imports, and prioritized route preload groups. |
| `desktopRouter.config.tsx`         | Thin Web adapter: mounts the common content tree at `/` and adds Web-only routes.                               |
| `desktopRouter.config.desktop.tsx` | Thin Electron adapter: injects per-tab Home behavior, TabHost root stubs, and Electron-only onboarding.         |

Add or remove common routes only in `desktopRouter.shared.tsx`. Keep `desktopRouter.sync.test.tsx` passing so path behavior, lazy boundaries, preload ownership, and the intentional platform differences remain verified.

---

## 3b. Other `.desktop.{ts,tsx}` variants inside `src/routes/`

The thin router adapters are not duplicated trees. Other route modules may still colocate a `<name>.desktop.{ts,tsx}` next to a base `<name>.{ts,tsx}`; Vite's resolver swaps in the `.desktop` file for Electron builds. Those paired module implementations still carry a drift risk.

Known variants today:

| Base file (web)                                       | Desktop file (Electron)                                       | Purpose                                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/routes/(main)/settings/features/componentMap.ts` | `src/routes/(main)/settings/features/componentMap.desktop.ts` | Settings tab → component map. Web uses dynamic `import()`; desktop uses sync imports. `componentMap.sync.test.ts` enforces identical keys. |
| `src/routes/(main)/agent/index.tsx`                   | `src/routes/(main)/agent/index.desktop.tsx`                   | Page entry. Desktop variant overrides the web page wholesale (e.g. extra popup guards).                                                    |
| `src/routes/(main)/group/index.tsx`                   | `src/routes/(main)/group/index.desktop.tsx`                   | Same pattern as agent.                                                                                                                     |

**Rules:**

1. After editing **any** `.ts`/`.tsx` under `src/routes/`, glob the same directory for a `<filename>.desktop.{ts,tsx}` sibling. If one exists, apply the equivalent change there in the same commit.
2. When adding a new SettingsTab, register it in **both** `componentMap.ts` (with `dynamic(...)`) and `componentMap.desktop.ts` (with a sync `import`). `componentMap.sync.test.ts` will fail the build otherwise.
3. When adding a new desktop-only page wholesale-override, prefer a single base file with platform-aware code over introducing a new `.desktop.tsx` variant — only add a new variant when the two trees genuinely diverge (different store wiring, different popup guards, etc.).
4. When deleting, remove **both** files together.

---

## 4. How to Divide Files (route vs feature)

| Question                                                 | Put in `src/routes/`                                     | Put in `src/features/`       |
| -------------------------------------------------------- | -------------------------------------------------------- | ---------------------------- |
| Is it the route’s layout wrapper or page entry?          | Yes – `_layout/index.tsx`, `index.tsx`, `[id]/index.tsx` | No                           |
| Does it contain business logic or non-trivial UI?        | No                                                       | Yes – under the right domain |
| Is it a reusable layout piece (sidebar, header, body)?   | No                                                       | Yes                          |
| Is it a hook, store usage, or domain logic?              | No                                                       | Yes                          |
| Is it only re-exporting or composing feature components? | Yes                                                      | No                           |

**Examples**

- **Route (thin):**\
  `src/routes/(main)/page/_layout/index.tsx` → `export { default } from '@/features/Pages/PageLayout'`
- **Feature (real implementation):**\
  `src/features/Pages/PageLayout/` → Sidebar, DataSync, Body, Header, styles, etc.
- **Route (thin):**\
  `src/routes/(main)/page/index.tsx` → Import `PageTitle`, `PageExplorerPlaceholder` from `@/features/Pages` and `@/features/PageExplorer`; render with `<PageTitle />` and placeholder.
- **Feature:**\
  Page list, actions, drawers, and hooks live under `src/features/Pages/`.

---

## 5. Progressive Migration (existing code)

We are migrating existing routes to this structure step by step:

- **Phase 1 (done):** `/page` route – segment files in `src/routes/(main)/page/`, implementation in `src/features/Pages/`.
- **Later phases:** home, settings, agent/group, community/resource/memory, mobile/share/onboarding.

When touching an old route that still has logic or `features/` inside `src/routes/`:

1. Prefer adding **new** code in `src/features/<Domain>/` and importing from routes.
2. For larger refactors, move existing route-only logic into the right feature and then thin out the route files (re-export or compose from features).
3. Use `git mv` when moving files so history is preserved.

---

## 6. Reference Structure (after Phase 1)

**Route (thin):**

```
src/routes/(main)/page/
├── _layout/index.tsx   → re-export or compose from @/features/Pages/PageLayout
├── index.tsx          → import from @/features/Pages, @/features/PageExplorer
└── [id]/index.tsx     → import from @/features/Pages, @/features/PageExplorer
```

**Feature (implementation):**

```
src/features/Pages/
├── index.ts            → export PageLayout, PageTitle
├── PageTitle.tsx
└── PageLayout/
    ├── index.tsx       → Sidebar + Outlet + DataSync
    ├── DataSync.tsx
    ├── Sidebar.tsx
    ├── style.ts
    ├── Body/           → list, actions, drawer, etc.
    └── Header/         → breadcrumb, add button, etc.
```

Router config continues to point at **route** paths (e.g. `@/routes/(main)/page`, `@/routes/(main)/page/_layout`); route files then delegate to features.
