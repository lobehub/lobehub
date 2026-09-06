---
name: testing
description: 'Vitest testing guide. Use when writing or updating tests, fixing failing tests, improving coverage, debugging test issues, or setting up mocks.'
user-invocable: false
---

# LobeHub Testing Guide

## Quick Reference

**Commands:**

```bash
# Run specific test file
bunx vitest run --silent='passed-only' '[file-path]'

# Database package (client-db, PGlite — default, skips BM25/pg_search)
cd packages/database && bunx vitest run --silent='passed-only' '[file]'

# Database package (server-db, Postgres — BM25/pgvector parity, what CI measures coverage in)
cd packages/database && TEST_SERVER_DB=1 bunx vitest run --silent='passed-only' '[file]'
```

**Never run** `bun run test` - it runs all 3000+ tests (\~10 minutes).

> **Database models/repositories:** every new file under `packages/database/src/models/**`
> or `src/repositories/**` ships with a sibling `__tests__/<name>.test.ts` in the same PR.
> Use the real DB via `getTestDB()` (integration style), guard BM25/full-text-search blocks
> with `describe.skipIf(!isServerDB)`, and always test user-isolation. See
> `references/db-model-test.md` for setup, schema gotchas, and the client-vs-server-db split.

## Test Categories

| Category | Location                    | Config                          |
| -------- | --------------------------- | ------------------------------- |
| Webapp   | `src/**/*.test.ts(x)`       | `vitest.config.ts`              |
| Packages | `packages/*/**/*.test.ts`   | `packages/*/vitest.config.ts`   |
| Desktop  | `apps/desktop/**/*.test.ts` | `apps/desktop/vitest.config.ts` |

## Core Principles

1. **Prefer `vi.spyOn` over `vi.mock`** - More targeted, easier to maintain. The root Vitest configs do not restore mocks automatically; restore spies in test cleanup with `vi.restoreAllMocks()`.
2. **Test behavior, not implementation details**
3. **Regression tests for bug fixes** - Include a regression test that fails without the fix and passes with it; write the failing test first when the failure is easy to reproduce. **Skip** pure style/CSS fixes (selector, hover, mask, spacing, color) when the only practical assertion would be source-string matching on the stylesheet — that is not a regression test worth shipping.
4. **No new component tests** - Only update existing React component tests. Complex logic should be extracted into hooks and tested there instead

## UI Library Mocks (@lobehub/ui/base-ui)

**Default: do NOT mock `@lobehub/ui/base-ui` — render the real components.**
`vitest.config.mts` redirects the library's internal MotionProvider to a static
stub (`tests/mocks/lobehubUiMotionProvider.tsx`), so base-ui components render in
tests without the app-level ConfigProvider. `Please wrap your app with <ConfigProvider> (or <MotionProvider>)` in a test means that redirect is not in
effect (e.g. a package-local vitest config) — do not fix it by hand-mocking every
component.

When a test genuinely wants simplified DOM, compose the canonical stubs over the
real module instead of writing a closed factory (closed factories break whenever
the library migrates a component's import path):

```typescript
vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));
```

`~base-ui-stubs` (`tests/mocks/baseUiStubs.tsx`) covers ActionIcon / Button /
Text / Tag / Avatar / Alert / toast / confirmModal / createModal with standard
aria semantics. A per-file factory is still fine when assertions need bespoke
testid conventions — but keep it composed over `importOriginal` so unknown
exports never go missing.

## Detailed Guides

See `references/` for specific testing scenarios:

- **Database Model testing**: `references/db-model-test.md`
- **Electron IPC testing**: `references/electron-ipc-test.md`
- **Zustand Store Action testing**: `references/zustand-store-action-test.md`
- **Agent Runtime E2E testing**: `references/agent-runtime-e2e.md`
- **Desktop Controller testing**: `references/desktop-controller-test.md`

## Fixing Failing Tests — Optimize or Delete?

When tests fail due to implementation changes (not bugs), evaluate before blindly fixing:

### Keep & Fix (update test data/assertions)

- **Behavior tests**: Tests that verify _what_ the code does (output, side effects, user-visible behavior). Just update mock data formats or expected values.
  - Example: Tool data structure changed from `{ name }` to `{ function: { name } }` → update mock data
  - Example: Output format changed from `Current date: YYYY-MM-DD` to `Current date: YYYY-MM-DD (TZ)` → update expected string

### Delete (over-specified, low value)

- **Param-forwarding tests**: Tests that assert exact internal function call arguments (e.g., `expect(internalFn).toHaveBeenCalledWith(expect.objectContaining({ exact params }))`) — these break on every refactor and duplicate what behavior tests already cover.
- **Implementation-coupled tests**: Tests that verify _how_ the code works internally rather than _what_ it produces. If a higher-level test already covers the same behavior, the low-level test adds maintenance cost without coverage gain.

### Decision Checklist

1. Does the test verify **externally observable behavior** (API response, DB write, rendered output)? → **Keep**
2. Does the test only verify **internal wiring** (which function receives which params)? → Check if a behavior test already covers it. If yes → **Delete**
3. Is the same behavior already tested at a **higher integration level**? → Delete the lower-level duplicate
4. Would the test break again on the **next routine refactor**? → Consider raising to integration level or deleting

### When Writing New Tests

- Prefer **integration-level assertions** (verify final output) over **white-box assertions** (verify internal calls)
- Use `expect.objectContaining` only for stable, public-facing contracts — not for internal param shapes that change with refactors
- Mock at boundaries (DB, network, external services), not between internal modules
