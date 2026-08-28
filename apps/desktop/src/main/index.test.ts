import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { appBootstrap, appConstructor, installProcessErrorHandlers } = vi.hoisted(() => ({
  appBootstrap: vi.fn(),
  appConstructor: vi.fn(),
  installProcessErrorHandlers: vi.fn(),
}));

vi.mock('./pre-app-init', () => ({}));

vi.mock('./core/App', () => ({
  App: class {
    bootstrap = appBootstrap;

    constructor() {
      appConstructor();
    }
  },
}));

vi.mock('./process-error-handlers', () => ({ installProcessErrorHandlers }));

const bootstrapKey = '__LOBEHUB_DESKTOP_MAIN_BOOTSTRAPPED__';
const mainProcessGlobal = globalThis as typeof globalThis & Record<string, boolean | undefined>;

describe('main process entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete mainProcessGlobal[bootstrapKey];
  });

  afterEach(() => {
    delete mainProcessGlobal[bootstrapKey];
  });

  it('initializes the application only once when the entry module is evaluated again', async () => {
    await import('./index');

    vi.resetModules();
    await import('./index');

    expect(installProcessErrorHandlers).toHaveBeenCalledTimes(1);
    expect(appConstructor).toHaveBeenCalledTimes(1);
    expect(appBootstrap).toHaveBeenCalledTimes(1);
  });
});
