/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureBuiltinToolSurfaces: vi.fn().mockResolvedValue(undefined),
  registerBuiltinToolExecutors: vi.fn(),
  setPostRenderReady: vi.fn(),
  shouldSkipRoutePreload: vi.fn().mockReturnValue(false),
  startConnectorInitialization: vi.fn(),
  startRoutePreload: vi.fn(),
}));

vi.mock('../atoms/app', () => ({
  setPostRenderReady: mocks.setPostRenderReady,
}));

vi.mock('@/store/tool/slices/builtin/executors', () => ({
  registerBuiltinToolExecutors: mocks.registerBuiltinToolExecutors,
}));

vi.mock('./connectors', () => ({
  startConnectorInitialization: mocks.startConnectorInitialization,
}));

vi.mock('./routePreload', () => ({
  shouldSkipRoutePreload: mocks.shouldSkipRoutePreload,
  startRoutePreload: mocks.startRoutePreload,
}));

vi.mock('./toolSurfaces', () => ({
  ensureBuiltinToolSurfaces: mocks.ensureBuiltinToolSurfaces,
}));

describe('startPostRenderInitialization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.shouldSkipRoutePreload.mockReturnValue(false);

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
    Object.defineProperty(window.navigator, 'connection', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs post-render warmups without preloading builtin executors', async () => {
    const { startPostRenderInitialization } = await import('./postRender');

    startPostRenderInitialization();

    expect(mocks.startConnectorInitialization).not.toHaveBeenCalled();
    expect(mocks.ensureBuiltinToolSurfaces).not.toHaveBeenCalled();
    expect(mocks.setPostRenderReady).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(mocks.registerBuiltinToolExecutors).not.toHaveBeenCalled();
    expect(mocks.ensureBuiltinToolSurfaces).toHaveBeenCalledTimes(1);
    expect(mocks.setPostRenderReady).toHaveBeenCalledWith(true);
    expect(mocks.startConnectorInitialization).toHaveBeenCalledTimes(1);
    expect(mocks.startRoutePreload).toHaveBeenCalledTimes(1);
  });

  it('starts post-render initialization only once', async () => {
    const { startPostRenderInitialization } = await import('./postRender');

    startPostRenderInitialization();
    startPostRenderInitialization();
    await vi.runAllTimersAsync();

    expect(mocks.registerBuiltinToolExecutors).not.toHaveBeenCalled();
    expect(mocks.ensureBuiltinToolSurfaces).toHaveBeenCalledTimes(1);
    expect(mocks.setPostRenderReady).toHaveBeenCalledTimes(1);
    expect(mocks.startConnectorInitialization).toHaveBeenCalledTimes(1);
    expect(mocks.startRoutePreload).toHaveBeenCalledTimes(1);
  });

  it('does not preload builtin tool surfaces when background preloading is disabled', async () => {
    mocks.shouldSkipRoutePreload.mockReturnValue(true);
    const { startPostRenderInitialization } = await import('./postRender');

    startPostRenderInitialization();
    await vi.runAllTimersAsync();

    expect(mocks.ensureBuiltinToolSurfaces).not.toHaveBeenCalled();
    expect(mocks.setPostRenderReady).toHaveBeenCalledWith(true);
    expect(mocks.startRoutePreload).toHaveBeenCalledTimes(1);
  });
});
