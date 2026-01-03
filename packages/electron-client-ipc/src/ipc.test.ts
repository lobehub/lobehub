import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const restoreWindow = (() => {
  const originalWindow = (globalThis as any).window;

  return () => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis as any, 'window');
      return;
    }
    (globalThis as any).window = originalWindow;
  };
})();

describe('getElectronIpc', () => {
  beforeEach(() => {
    vi.resetModules();
    restoreWindow();
  });

  afterEach(() => {
    restoreWindow();
  });

  it('returns null when window is not defined', async () => {
    Reflect.deleteProperty(globalThis as any, 'window');
    const { getElectronIpc } = await import('./ipc');

    expect(getElectronIpc()).toBeNull();
  });

  it('returns null when invoke is missing on electronAPI', async () => {
    (globalThis as any).window = { electronAPI: {} };
    const { getElectronIpc } = await import('./ipc');

    expect(getElectronIpc()).toBeNull();
  });

  it('creates a cached proxy and forwards payloads to invoke', async () => {
    const invoke = vi.fn();
    (globalThis as any).window = {
      electronAPI: {
        invoke,
        onStreamInvoke: vi.fn(),
      },
    };

    const { getElectronIpc } = await import('./ipc');

    const ipc = getElectronIpc();
    expect(ipc).not.toBeNull();

    await (ipc as any).system.updateLocale('en-US');
    expect(invoke).toHaveBeenCalledWith('system.updateLocale', 'en-US');

    await (ipc as any).windows.closeWindow();
    expect(invoke).toHaveBeenCalledWith('windows.closeWindow');

    const cached = getElectronIpc();
    expect(cached).toBe(ipc);
  });
});
