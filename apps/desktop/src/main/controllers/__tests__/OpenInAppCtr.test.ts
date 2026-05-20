import type { DetectedApp, OpenInAppResult } from '@lobechat/electron-client-ipc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import type { IpcContext } from '@/utils/ipc';
import { IpcHandler } from '@/utils/ipc/base';

import OpenInAppCtr from '../OpenInAppCtr';

const { getCachedDetectionMock, detectAppMock, launchAppMock, ipcHandlers, ipcMainHandleMock } =
  vi.hoisted(() => {
    const handlers = new Map<string, (event: any, ...args: any[]) => any>();
    const handle = vi.fn((channel: string, handler: any) => {
      handlers.set(channel, handler);
    });
    return {
      detectAppMock: vi.fn(),
      getCachedDetectionMock: vi.fn(),
      ipcHandlers: handlers,
      ipcMainHandleMock: handle,
      launchAppMock: vi.fn(),
    };
  });

const invokeIpc = async <T = any>(
  channel: string,
  payload?: any,
  context?: Partial<IpcContext>,
): Promise<T> => {
  const handler = ipcHandlers.get(channel);
  if (!handler) throw new Error(`IPC handler for ${channel} not found`);

  const fakeEvent = {
    sender: context?.sender ?? ({ id: 'test' } as any),
  };

  if (payload === undefined) {
    return handler(fakeEvent);
  }

  return handler(fakeEvent, payload);
};

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

vi.mock('@/modules/openInApp/cache', () => ({
  getCachedDetection: getCachedDetectionMock,
}));

vi.mock('@/modules/openInApp/detectors', () => ({
  detectApp: detectAppMock,
}));

vi.mock('@/modules/openInApp/launchers', () => ({
  launchApp: launchAppMock,
}));

const mockApp = {} as unknown as App;

describe('OpenInAppCtr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipcHandlers.clear();
    ipcMainHandleMock.mockClear();
    (IpcHandler.getInstance() as any).registeredChannels?.clear();
    new OpenInAppCtr(mockApp);
  });

  describe('detectApps', () => {
    it('should call getCachedDetection and return the apps list', async () => {
      const apps: DetectedApp[] = [
        { displayName: 'Visual Studio Code', id: 'vscode', installed: true },
        { displayName: 'Cursor', id: 'cursor', installed: false },
      ];
      getCachedDetectionMock.mockResolvedValue(apps);

      const result = await invokeIpc('openInApp.detectApps');

      expect(getCachedDetectionMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ apps });
    });
  });

  describe('openInApp', () => {
    it('should launch the app when installed', async () => {
      detectAppMock.mockResolvedValue(true);
      const launchResult: OpenInAppResult = { success: true };
      launchAppMock.mockResolvedValue(launchResult);

      const result = await invokeIpc('openInApp.openInApp', {
        appId: 'vscode',
        path: '/tmp/project',
      });

      expect(detectAppMock).toHaveBeenCalledWith('vscode', process.platform);
      expect(launchAppMock).toHaveBeenCalledWith('vscode', '/tmp/project', process.platform);
      expect(result).toEqual({ success: true });
    });

    it('should not launch and return error when app is not installed', async () => {
      detectAppMock.mockResolvedValue(false);

      const result = await invokeIpc('openInApp.openInApp', {
        appId: 'cursor',
        path: '/tmp/project',
      });

      expect(detectAppMock).toHaveBeenCalledWith('cursor', process.platform);
      expect(launchAppMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        error: 'cursor is not installed',
        success: false,
      });
    });

    it('should pass through launch errors when launchApp fails', async () => {
      detectAppMock.mockResolvedValue(true);
      const launchResult: OpenInAppResult = {
        error: 'Path not found: /tmp/missing',
        success: false,
      };
      launchAppMock.mockResolvedValue(launchResult);

      const result = await invokeIpc('openInApp.openInApp', {
        appId: 'vscode',
        path: '/tmp/missing',
      });

      expect(detectAppMock).toHaveBeenCalledWith('vscode', process.platform);
      expect(launchAppMock).toHaveBeenCalledWith('vscode', '/tmp/missing', process.platform);
      expect(result).toEqual(launchResult);
    });
  });
});
