import { InterceptRouteParams } from '@lobechat/electron-client-ipc';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppBrowsersIdentifiers, BrowsersIdentifiers } from '@/appBrowsers';
import type { App } from '@/core/App';
import type { IpcContext } from '@/utils/ipc';
import { runWithIpcContext } from '@/utils/ipc';

import BrowserWindowsCtr from '../BrowserWindowsCtr';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

// 模拟 App 及其依赖项
const mockToggleVisible = vi.fn();
const mockLoadUrl = vi.fn();
const mockShow = vi.fn();
const mockBroadcast = vi.fn();
const mockRedirectToPage = vi.fn();
const mockCloseWindow = vi.fn();
const mockMinimizeWindow = vi.fn();
const mockMaximizeWindow = vi.fn();
const mockRetrieveByIdentifier = vi.fn();
const testSenderIdentifierString: string = 'test-window-event-id';

const mockGetIdentifierByWebContents = vi.fn(() => testSenderIdentifierString);
const mockGetMainWindow = vi.fn(() => ({
  toggleVisible: mockToggleVisible,
  loadUrl: mockLoadUrl,
  show: mockShow,
  broadcast: mockBroadcast,
}));
const mockShowOther = vi.fn();

// mock findMatchingRoute and extractSubPath
vi.mock('~common/routes', async () => ({
  findMatchingRoute: vi.fn(),
  extractSubPath: vi.fn(),
}));
const { findMatchingRoute } = await import('~common/routes');

const mockApp = {
  browserManager: {
    getIdentifierByWebContents: mockGetIdentifierByWebContents,
    getMainWindow: mockGetMainWindow,
    redirectToPage: mockRedirectToPage,
    closeWindow: mockCloseWindow,
    minimizeWindow: mockMinimizeWindow,
    maximizeWindow: mockMaximizeWindow,
    retrieveByIdentifier: mockRetrieveByIdentifier.mockImplementation(
      (identifier: AppBrowsersIdentifiers | string) => {
        if (identifier === 'some-other-window') {
          return { show: mockShowOther };
        }
        return { show: mockShowOther }; // Default mock for other identifiers
      },
    ),
  },
} as unknown as App;

describe('BrowserWindowsCtr', () => {
  let browserWindowsCtr: BrowserWindowsCtr;

  beforeEach(() => {
    vi.clearAllMocks();
    ipcMainHandleMock.mockClear();
    browserWindowsCtr = new BrowserWindowsCtr(mockApp);
  });

  describe('toggleMainWindow', () => {
    it('should get the main window and toggle its visibility', async () => {
      await browserWindowsCtr.toggleMainWindow();
      expect(mockGetMainWindow).toHaveBeenCalled();
      expect(mockToggleVisible).toHaveBeenCalled();
    });
  });

  describe('openSettingsWindow', () => {
    it('should navigate to settings in main window with the specified path', async () => {
      const path = '/settings/common';
      const result = await browserWindowsCtr.openSettingsWindow({ path });
      expect(mockGetMainWindow).toHaveBeenCalled();
      expect(mockShow).toHaveBeenCalled();
      expect(mockBroadcast).toHaveBeenCalledWith('navigate', {
        path: '/settings/common',
      });
      expect(result).toEqual({ success: true });
    });

    it('should return error if navigation fails', async () => {
      const errorMessage = 'Failed to navigate';
      mockBroadcast.mockImplementationOnce(() => {
        throw new Error(errorMessage);
      });
      const result = await browserWindowsCtr.openSettingsWindow({ path: '/settings/common' });
      expect(result).toEqual({ error: errorMessage, success: false });
    });
  });

  describe('closeWindow', () => {
    it('should close the window with the given sender identifier', () => {
      const sender = {} as any;
      const context = { sender, event: { sender } as any } as IpcContext;
      runWithIpcContext(context, () => browserWindowsCtr.closeWindow());
      expect(mockGetIdentifierByWebContents).toHaveBeenCalledWith(context.sender);
      expect(mockCloseWindow).toHaveBeenCalledWith(testSenderIdentifierString);
    });
  });

  describe('minimizeWindow', () => {
    it('should minimize the window with the given sender identifier', () => {
      const sender = {} as any;
      const context = { sender, event: { sender } as any } as IpcContext;
      runWithIpcContext(context, () => browserWindowsCtr.minimizeWindow());
      expect(mockGetIdentifierByWebContents).toHaveBeenCalledWith(context.sender);
      expect(mockMinimizeWindow).toHaveBeenCalledWith(testSenderIdentifierString);
    });
  });

  describe('maximizeWindow', () => {
    it('should maximize the window with the given sender identifier', () => {
      const sender = {} as any;
      const context = { sender, event: { sender } as any } as IpcContext;
      runWithIpcContext(context, () => browserWindowsCtr.maximizeWindow());
      expect(mockGetIdentifierByWebContents).toHaveBeenCalledWith(context.sender);
      expect(mockMaximizeWindow).toHaveBeenCalledWith(testSenderIdentifierString);
    });
  });

  describe('interceptRoute', () => {
    const baseParams = { source: 'link-click' as const };

    it('should not intercept if no matching route is found', async () => {
      const params: InterceptRouteParams = {
        ...baseParams,
        path: '/unknown/route',
        url: 'app://host/unknown/route',
      };
      (findMatchingRoute as Mock).mockReturnValue(undefined);
      const result = await browserWindowsCtr.interceptRoute(params);
      expect(findMatchingRoute).toHaveBeenCalledWith(params.path);
      expect(result).toEqual({ intercepted: false, path: params.path, source: params.source });
    });

    it('should open target window if matched route is found', async () => {
      const params: InterceptRouteParams = {
        ...baseParams,
        path: '/other/page',
        url: 'app://host/other/page',
      };
      const targetWindowIdentifier = 'some-other-window' as AppBrowsersIdentifiers;
      const matchedRoute = { targetWindow: targetWindowIdentifier, pathPrefix: '/other' };
      (findMatchingRoute as Mock).mockReturnValue(matchedRoute);

      const result = await browserWindowsCtr.interceptRoute(params);

      expect(findMatchingRoute).toHaveBeenCalledWith(params.path);
      expect(mockRetrieveByIdentifier).toHaveBeenCalledWith(targetWindowIdentifier);
      expect(mockShowOther).toHaveBeenCalled();
      expect(result).toEqual({
        intercepted: true,
        path: params.path,
        source: params.source,
        targetWindow: matchedRoute.targetWindow,
      });
    });

    it('should return error if processing route interception fails', async () => {
      const params: InterceptRouteParams = {
        ...baseParams,
        path: '/another/custom',
        url: 'app://host/another/custom',
      };
      const targetWindowIdentifier = 'another-custom-window' as AppBrowsersIdentifiers;
      const matchedRoute = { targetWindow: targetWindowIdentifier, pathPrefix: '/another' };
      const errorMessage = 'Processing error for other window';
      (findMatchingRoute as Mock).mockReturnValue(matchedRoute);
      mockRetrieveByIdentifier.mockImplementationOnce(() => {
        throw new Error(errorMessage);
      });

      const result = await browserWindowsCtr.interceptRoute(params);

      expect(result).toEqual({
        error: errorMessage,
        intercepted: false,
        path: params.path,
        source: params.source,
      });
    });
  });
});
