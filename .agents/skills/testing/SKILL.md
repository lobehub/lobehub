---
name: testing
description: Testing guide using Vitest. Use when writing tests (.test.ts, .test.tsx), fixing failing tests, improving test coverage, or debugging test issues. Triggers on test creation, test debugging, mock setup, or test-related questions.
---

# LobeChat Testing Guide

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

## Common Issues

1. **Module pollution**: Use `vi.resetModules()` when tests fail mysteriously
2. **Mock not working**: Check setup position and use `vi.clearAllMocks()` in beforeEach
3. **Test data pollution**: Clean database state in beforeEach/afterEach
4. **Async issues**: Wrap state changes in `act()` for React hooks
