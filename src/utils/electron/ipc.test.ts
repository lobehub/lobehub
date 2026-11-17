import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const environment = vi.hoisted(() => ({ isDesktop: false }));
const track = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  get isDesktop() {
    return environment.isDesktop;
  },
}));

vi.mock('@/libs/analytics/client', () => ({ analyticsClient: { track } }));

const setElectronApi = (electronAPI: unknown) => {
  (window as any).electronAPI = electronAPI;
};

const loadIpc = async () => {
  // The IPC proxy and the once-per-page report are module state.
  vi.resetModules();
  return import('./ipc');
};

describe('ensureElectronIpc', () => {
  beforeEach(() => {
    environment.isDesktop = false;
    track.mockClear();
    setElectronApi(undefined);
  });

  afterEach(() => {
    setElectronApi(undefined);
  });

  it('returns the IPC proxy when the preload exposes invoke', async () => {
    const invoke = vi.fn().mockResolvedValue('ok');
    setElectronApi({ invoke });
    const { ensureElectronIpc, getDesktopIpcUnavailableReason } = await loadIpc();

    const ipc = ensureElectronIpc() as any;
    await expect(ipc.system.getInfo()).resolves.toBe('ok');
    expect(invoke).toHaveBeenCalledWith('system.getInfo');
    expect(getDesktopIpcUnavailableReason()).toBeUndefined();
  });

  it('tells a web browser to open LobeHub Desktop instead of blaming the preload', async () => {
    const { DesktopIpcUnavailableError, ensureElectronIpc, getDesktopIpcUnavailableReason } =
      await loadIpc();

    expect(getDesktopIpcUnavailableReason()).toBe('not-desktop');
    expect(() => ensureElectronIpc()).toThrow(DesktopIpcUnavailableError);
    expect(() => ensureElectronIpc()).toThrow(/running in a web browser.*LobeHub Desktop/);
    expect(() => ensureElectronIpc()).not.toThrow(/Ensure the preload/);
    // Reaching a desktop-only action from the web is expected, not an anomaly.
    expect(track).not.toHaveBeenCalled();
  });

  it('asks a desktop window without the bridge to reload and reports it once', async () => {
    environment.isDesktop = true;
    const { ensureElectronIpc, getDesktopIpcUnavailableReason } = await loadIpc();

    expect(getDesktopIpcUnavailableReason()).toBe('preload-missing');

    let error: any;
    try {
      ensureElectronIpc();
    } catch (e) {
      error = e;
    }
    expect(error?.reason).toBe('preload-missing');
    expect(error?.message).toMatch(
      /Reload the window \(Cmd\/Ctrl\+R\) to reconnect it, or restart LobeHub Desktop/,
    );

    expect(() => ensureElectronIpc()).toThrow();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith({
      name: 'desktop_ipc_unavailable',
      properties: { reason: 'preload-missing', source: 'ipc' },
    });
  });
});
