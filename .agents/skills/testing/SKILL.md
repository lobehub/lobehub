---
name: testing
description: Testing guide using Vitest. Use when writing tests (.test.ts, .test.tsx), fixing failing tests, improving test coverage, or debugging test issues. Triggers on test creation, test debugging, mock setup, or test-related questions.
---

# LobeHub Testing Guide

## Quick Reference

**Commands:**

```bash
# Run specific test file
bunx vitest run --silent='passed-only' '[file-path]'

# Database package (client)
cd packages/database && bunx vitest run --silent='passed-only' '[file]'

# Database package (server)
cd packages/database && TEST_SERVER_DB=1 bunx vitest run --silent='passed-only' '[file]'
```

**Never run** `bun run test` - it runs all 3000+ tests (\~10 minutes).

## Test Categories

| Category | Location                    | Config                          |
| -------- | --------------------------- | ------------------------------- |
| Webapp   | `src/**/*.test.ts(x)`       | `vitest.config.ts`              |
| Packages | `packages/*/**/*.test.ts`   | `packages/*/vitest.config.ts`   |
| Desktop  | `apps/desktop/**/*.test.ts` | `apps/desktop/vitest.config.ts` |

## Core Principles

1. **Prefer `vi.spyOn` over `vi.mock`** - More targeted, easier to maintain
2. **Tests must pass type check** - Run `bun run type-check` after writing tests
3. **After 1-2 failed fix attempts, stop and ask for help**
4. **Test behavior, not implementation details**

## Basic Test Structure

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ModuleName', () => {
  describe('functionName', () => {
    it('should handle normal case', () => {
      // Arrange → Act → Assert
    });
  });
});
```

## Mock Patterns

```typescript
// ✅ Spy on direct dependencies
vi.spyOn(messageService, 'createMessage').mockResolvedValue('id');

// ✅ Use vi.stubGlobal for browser APIs
vi.stubGlobal('Image', mockImage);
vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');

// ❌ Avoid mocking entire modules globally
vi.mock('@/services/chat'); // Too broad
```

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

## Common Issues

1. **Module pollution**: Use `vi.resetModules()` when tests fail mysteriously
2. **Mock not working**: Check setup position and use `vi.clearAllMocks()` in beforeEach
3. **Test data pollution**: Clean database state in beforeEach/afterEach
4. **Async issues**: Wrap state changes in `act()` for React hooks
