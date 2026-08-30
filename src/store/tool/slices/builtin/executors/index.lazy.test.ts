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
});
