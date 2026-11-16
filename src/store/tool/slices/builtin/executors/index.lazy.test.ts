import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  catalogEvaluated: vi.fn(),
}));

vi.mock('./catalog', () => {
  mocks.catalogEvaluated();
  return { builtinToolExecutors: [] };
});

describe('builtin executor catalog loading', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.catalogEvaluated.mockClear();
  });

  it(
    'keeps executor implementations out of the registry shell import',
    { timeout: 30_000 },
    async () => {
      const { registerBuiltinToolExecutors } = await import('./index');

      expect(mocks.catalogEvaluated).not.toHaveBeenCalled();

      await registerBuiltinToolExecutors();

      expect(mocks.catalogEvaluated).toHaveBeenCalledTimes(1);
    },
  );

  it(
    'tells the tool caller to reload the window when the catalog module fails to load',
    { timeout: 30_000 },
    async () => {
      const importError = new TypeError(
        'Failed to fetch dynamically imported module: app://renderer/src/store/tool/slices/builtin/executors/catalog.ts',
      );
      // Vitest wraps errors thrown by a mock factory, so fail on first access
      // to the export instead: the registration promise rejects with the same
      // error a failed `import('./catalog')` would carry.
      vi.doMock('./catalog', () => ({
        get builtinToolExecutors(): never {
          throw importError;
        },
      }));

      const { invokeExecutor } = await import('./index');
      const failure = await invokeExecutor('lobe-browser', 'navigate', {}, {}).catch(
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(importError.message);
      expect((failure as Error).message).toContain(
        'reload the app window or page, then retry the tool call',
      );
      expect((failure as Error).cause).toBe(importError);
    },
  );
});
