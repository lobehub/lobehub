/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerBuiltinToolExecutors: vi.fn(),
  startConnectorInitialization: vi.fn(),
}));

vi.mock('@/store/tool/slices/builtin/executors', () => ({
  registerBuiltinToolExecutors: mocks.registerBuiltinToolExecutors,
}));

vi.mock('./connectors', () => ({
  startConnectorInitialization: mocks.startConnectorInitialization,
}));

describe('startPostRenderInitialization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: undefined,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defers connector initialization out of the synchronous bootstrap path', async () => {
    const { startPostRenderInitialization } = await import('./postRender');

    startPostRenderInitialization();

    expect(mocks.startConnectorInitialization).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(mocks.registerBuiltinToolExecutors).toHaveBeenCalledTimes(1);
    expect(mocks.startConnectorInitialization).toHaveBeenCalledTimes(1);
  });

  it('starts post-render initialization only once', async () => {
    const { startPostRenderInitialization } = await import('./postRender');

    startPostRenderInitialization();
    startPostRenderInitialization();
    await vi.runAllTimersAsync();

    expect(mocks.registerBuiltinToolExecutors).toHaveBeenCalledTimes(1);
    expect(mocks.startConnectorInitialization).toHaveBeenCalledTimes(1);
  });
});
