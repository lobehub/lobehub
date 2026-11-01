import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  postRenderModuleEvaluated: vi.fn(),
  toolSurfacesModuleEvaluated: vi.fn(),
}));

vi.mock('react-dom', () => ({ flushSync: vi.fn((callback: () => void) => callback()) }));
vi.mock('@/libs/bootMetrics', () => ({ startBootMetricsFinalize: vi.fn() }));
vi.mock('@/libs/bootTiming', () => ({
  bootTiming: {
    mark: vi.fn(),
    span: vi.fn((_name: string, task: () => Promise<void>) => task()),
    spanSync: vi.fn((_name: string, task: () => void) => task()),
  },
}));
vi.mock('../atoms/app', () => ({ setAppReady: vi.fn() }));
vi.mock('.', () => ({ initializeApp: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./importSettings', () => ({ startImportSettingsFromUrl: vi.fn() }));
vi.mock('./postRender', () => {
  mocks.postRenderModuleEvaluated();
  return { startPostRenderInitialization: vi.fn() };
});
vi.mock('./toolSurfaces', () => {
  mocks.toolSurfacesModuleEvaluated();
  return { ensureBuiltinToolSurfaces: vi.fn() };
});

describe('SPA bootstrap imports', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.postRenderModuleEvaluated.mockClear();
    mocks.toolSurfacesModuleEvaluated.mockClear();
  });

  it('keeps idle-only initialization out of the synchronous bootstrap graph', async () => {
    await import('./bootstrap');

    expect(mocks.postRenderModuleEvaluated).not.toHaveBeenCalled();
    expect(mocks.toolSurfacesModuleEvaluated).not.toHaveBeenCalled();
  });
});
