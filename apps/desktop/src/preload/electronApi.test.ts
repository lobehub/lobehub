import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SetupElectronApiFunction } from './electronApi';

// Mock electron modules
const mockElectronAPI = { someAPI: 'mock-electron-api' };
const mockContextBridgeExposeInMainWorld = vi.fn();
const mockIpcRendererOn = vi.fn();
const mockIpcRendererSendSync = vi.fn();
const mockGetProcessMemoryInfo = vi.fn();

const originalGetProcessMemoryInfo = process.getProcessMemoryInfo;

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: mockContextBridgeExposeInMainWorld,
  },
  ipcRenderer: {
    on: mockIpcRendererOn,
    sendSync: mockIpcRendererSendSync,
  },
}));

vi.mock('@electron-toolkit/preload', () => ({
  electronAPI: mockElectronAPI,
}));

// Mock the invoke and streamer modules
const mockInvoke = vi.fn();
const mockOnStreamInvoke = vi.fn();

vi.mock('./invoke', () => ({
  invoke: mockInvoke,
}));

vi.mock('./streamer', () => ({
  onStreamInvoke: mockOnStreamInvoke,
}));

describe('setupElectronApi', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let setupElectronApi: SetupElectronApiFunction;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetProcessMemoryInfo.mockReset();
    Object.assign(process, { getProcessMemoryInfo: mockGetProcessMemoryInfo });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    ({ setupElectronApi } = await import('./electronApi'));
  });

  afterAll(() => {
    if (originalGetProcessMemoryInfo) process.getProcessMemoryInfo = originalGetProcessMemoryInfo;
    else Reflect.deleteProperty(process, 'getProcessMemoryInfo');
  });

  it('should expose electron API to main world', () => {
    setupElectronApi();

    expect(mockContextBridgeExposeInMainWorld).toHaveBeenCalledWith('electron', mockElectronAPI);
  });

  it('should expose electronAPI with invoke and onStreamInvoke methods', () => {
    setupElectronApi();

    const call = mockContextBridgeExposeInMainWorld.mock.calls.find((i) => i[0] === 'electronAPI');

    expect(call).toBeTruthy();
    expect(call?.[1]).toMatchObject({
      invoke: mockInvoke,
      getDesktopBootstrapIdentity: expect.any(Function),
      onScreenCaptureSession: expect.any(Function),
      onStreamInvoke: mockOnStreamInvoke,
    });
  });

  it('reads the bootstrap identity synchronously before renderer initialization', () => {
    const identity = { isIdentityResolved: true, userId: 'user-1' };
    mockIpcRendererSendSync.mockReturnValue(identity);
    setupElectronApi();

    const exposedAPI = mockContextBridgeExposeInMainWorld.mock.calls[1][1];

    expect(exposedAPI.getDesktopBootstrapIdentity()).toEqual(identity);
    expect(mockIpcRendererSendSync).toHaveBeenCalledWith('desktop:get-bootstrap-identity');
  });

  it('reads precise renderer process memory', async () => {
    mockGetProcessMemoryInfo.mockResolvedValue({ private: 2_621_440 });
    setupElectronApi();

    const exposedAPI = mockContextBridgeExposeInMainWorld.mock.calls[1][1];

    await expect(exposedAPI.getRendererMemoryInfo()).resolves.toEqual({
      privateBytes: 2_684_354_560,
    });
    expect(mockGetProcessMemoryInfo).toHaveBeenCalledOnce();
  });

  it('should expose lobeEnv with darwinMajorVersion, isMacTahoe, platform and version info', () => {
    setupElectronApi();

    const call = mockContextBridgeExposeInMainWorld.mock.calls.find((i) => i[0] === 'lobeEnv');
    expect(call).toBeTruthy();
    const exposedEnv = call?.[1] as any;

    expect(Object.prototype.hasOwnProperty.call(exposedEnv, 'darwinMajorVersion')).toBe(true);
    expect(
      exposedEnv.darwinMajorVersion === undefined ||
        typeof exposedEnv.darwinMajorVersion === 'number',
    ).toBe(true);

    expect(Object.prototype.hasOwnProperty.call(exposedEnv, 'isMacTahoe')).toBe(true);
    expect(typeof exposedEnv.isMacTahoe).toBe('boolean');

    expect(Object.prototype.hasOwnProperty.call(exposedEnv, 'platform')).toBe(true);
    expect(['darwin', 'linux', 'win32'].includes(exposedEnv.platform)).toBe(true);

    // electronVersion and chromeVersion may be undefined in Node.js test env
    expect(Object.prototype.hasOwnProperty.call(exposedEnv, 'electronVersion')).toBe(true);
    expect(
      exposedEnv.electronVersion === undefined || typeof exposedEnv.electronVersion === 'string',
    ).toBe(true);

    expect(Object.prototype.hasOwnProperty.call(exposedEnv, 'chromeVersion')).toBe(true);
    expect(
      exposedEnv.chromeVersion === undefined || typeof exposedEnv.chromeVersion === 'string',
    ).toBe(true);

    expect(Object.prototype.hasOwnProperty.call(exposedEnv, 'nodeVersion')).toBe(true);
    expect(typeof exposedEnv.nodeVersion).toBe('string');
  });

  it('should expose both APIs in correct order', () => {
    setupElectronApi();

    expect(mockContextBridgeExposeInMainWorld).toHaveBeenCalledTimes(3);

    // First call should be for 'electron'
    expect(mockContextBridgeExposeInMainWorld.mock.calls[0][0]).toBe('electron');
    expect(mockContextBridgeExposeInMainWorld.mock.calls[0][1]).toBe(mockElectronAPI);

    // Second call should be for 'electronAPI'
    expect(mockContextBridgeExposeInMainWorld.mock.calls[1][0]).toBe('electronAPI');
    expect(mockContextBridgeExposeInMainWorld.mock.calls[1][1]).toMatchObject({
      invoke: mockInvoke,
      onScreenCaptureSession: expect.any(Function),
      onStreamInvoke: mockOnStreamInvoke,
    });

    // Third call should be for 'lobeEnv'
    expect(mockContextBridgeExposeInMainWorld.mock.calls[2][0]).toBe('lobeEnv');
  });

  it('should handle errors when exposing electron API fails', () => {
    const error = new Error('Failed to expose electron API');
    mockContextBridgeExposeInMainWorld.mockImplementationOnce(() => {
      throw error;
    });

    setupElectronApi();

    expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    // Should still try to expose electronAPI and lobeEnv even if first one fails
    expect(mockContextBridgeExposeInMainWorld).toHaveBeenCalledTimes(3);
  });

  it('should continue execution if exposing electronAPI fails', () => {
    mockContextBridgeExposeInMainWorld
      .mockImplementationOnce(() => {}) // First call succeeds
      .mockImplementationOnce(() => {
        throw new Error('Failed to expose electronAPI');
      }); // Second call fails

    // The second call throws and is not caught, so it will throw
    // The error handling only wraps the first contextBridge.exposeInMainWorld call
    expect(() => setupElectronApi()).toThrow('Failed to expose electronAPI');

    expect(mockContextBridgeExposeInMainWorld).toHaveBeenCalledTimes(2);
  });

  it('should only catch errors for electron API exposure', () => {
    const error = new Error('Context bridge error');
    mockContextBridgeExposeInMainWorld.mockImplementationOnce(() => {
      throw error;
    });

    setupElectronApi();

    // Error should be logged, not thrown
    expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('should expose correct invoke function reference', () => {
    setupElectronApi();

    const exposedAPI = mockContextBridgeExposeInMainWorld.mock.calls[1][1];
    expect(exposedAPI.invoke).toBe(mockInvoke);
  });

  it('should expose correct onStreamInvoke function reference', () => {
    setupElectronApi();

    const exposedAPI = mockContextBridgeExposeInMainWorld.mock.calls[1][1];
    expect(exposedAPI.onStreamInvoke).toBe(mockOnStreamInvoke);
  });

  it('should subscribe to screenCaptureSession in preload and replay cached payloads', () => {
    setupElectronApi();

    expect(mockIpcRendererOn).toHaveBeenCalledWith('screenCaptureSession', expect.any(Function));

    const preloadListener = mockIpcRendererOn.mock.calls.find(
      ([channel]) => channel === 'screenCaptureSession',
    )?.[1];

    const session = {
      displayBounds: { height: 900, width: 1440, x: 0, y: 0 },
      scaleFactor: 2,
      windows: [],
    };

    preloadListener?.({}, session);

    const exposedAPI = mockContextBridgeExposeInMainWorld.mock.calls[1][1];
    const rendererListener = vi.fn();
    exposedAPI.onScreenCaptureSession(rendererListener);

    expect(rendererListener).toHaveBeenCalledWith(session);
  });

  it('should unsubscribe screenCapture session listeners', () => {
    setupElectronApi();

    const exposedAPI = mockContextBridgeExposeInMainWorld.mock.calls[1][1];
    const rendererListener = vi.fn();
    const unsubscribe = exposedAPI.onScreenCaptureSession(rendererListener);

    unsubscribe();

    const preloadListener = mockIpcRendererOn.mock.calls.find(
      ([channel]) => channel === 'screenCaptureSession',
    )?.[1];

    preloadListener?.(
      {},
      {
        displayBounds: { height: 900, width: 1440, x: 0, y: 0 },
        scaleFactor: 2,
        windows: [],
      },
    );

    expect(rendererListener).not.toHaveBeenCalled();
  });

  it('should not modify the original functions', () => {
    const originalInvoke = mockInvoke;
    const originalOnStreamInvoke = mockOnStreamInvoke;

    setupElectronApi();

    expect(mockInvoke).toBe(originalInvoke);
    expect(mockOnStreamInvoke).toBe(originalOnStreamInvoke);
  });

  it('should be callable multiple times without side effects', () => {
    setupElectronApi();
    setupElectronApi();

    // Should be called 6 times total (3 per setup call)
    expect(mockContextBridgeExposeInMainWorld).toHaveBeenCalledTimes(6);
  });
});
