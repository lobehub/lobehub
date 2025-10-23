import { InterceptRouteParams } from '@lobechat/electron-client-ipc';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppBrowsersIdentifiers, BrowsersIdentifiers } from '@/appBrowsers';
import type { App } from '@/core/App';
import type { IpcClientEventSender } from '@/types/ipcClientEvent';

import BrowserWindowsCtr from '../BrowserWindowsCtr';

// 模拟 App 及其依赖项
const mockToggleVisible = vi.fn();
const mockShowSettingsWindowWithTab = vi.fn();
const mockCloseWindow = vi.fn();
const mockMinimizeWindow = vi.fn();
const mockMaximizeWindow = vi.fn();
const mockRetrieveByIdentifier = vi.fn();
const mockGetMainWindow = vi.fn(() => ({
  toggleVisible: mockToggleVisible,
}));
const mockShow = vi.fn();

// mock findMatchingRoute and extractSubPath
vi.mock('~common/routes', async () => ({
  findMatchingRoute: vi.fn(),
  extractSubPath: vi.fn(),
}));
const { findMatchingRoute, extractSubPath } = await import('~common/routes');

const mockApp = {
  browserManager: {
    getMainWindow: mockGetMainWindow,
    showSettingsWindowWithTab: mockShowSettingsWindowWithTab,
    closeWindow: mockCloseWindow,
    minimizeWindow: mockMinimizeWindow,
    maximizeWindow: mockMaximizeWindow,
    retrieveByIdentifier: mockRetrieveByIdentifier.mockImplementation(
      (identifier: AppBrowsersIdentifiers | string) => {
        if (identifier === BrowsersIdentifiers.settings || identifier === 'some-other-window') {
          return { show: mockShow };
        }
        return { show: mockShow }; // Default mock for other identifiers
      },
    ),
  },
} as unknown as App;

describe('BrowserWindowsCtr', () => {
  let browserWindowsCtr: BrowserWindowsCtr;

  beforeEach(() => {
    vi.clearAllMocks();
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
    it('should show the settings window with the specified tab', async () => {
      const tab = 'appearance';
      const result = await browserWindowsCtr.openSettingsWindow(tab);
      expect(mockShowSettingsWindowWithTab).toHaveBeenCalledWith({ tab });
      expect(result).toEqual({ success: true });
    });

    it('should return error if showing settings window fails', async () => {
      const errorMessage = 'Failed to show';
      mockShowSettingsWindowWithTab.mockRejectedValueOnce(new Error(errorMessage));
      const result = await browserWindowsCtr.openSettingsWindow('display');
      expect(result).toEqual({ error: errorMessage, success: false });
    });
  });

  const testSenderIdentifierString: string = 'test-window-event-id';
  const sender: IpcClientEventSender = {
    identifier: testSenderIdentifierString,
  };

  describe('closeWindow', () => {
    it('should close the window with the given sender identifier', () => {
      browserWindowsCtr.closeWindow(undefined, sender);
      expect(mockCloseWindow).toHaveBeenCalledWith(testSenderIdentifierString);
    });
  });

  describe('minimizeWindow', () => {
    it('should minimize the window with the given sender identifier', () => {
      browserWindowsCtr.minimizeWindow(undefined, sender);
      expect(mockMinimizeWindow).toHaveBeenCalledWith(testSenderIdentifierString);
    });
  });

  describe('maximizeWindow', () => {
    it('should maximize the window with the given sender identifier', () => {
      browserWindowsCtr.maximizeWindow(undefined, sender);
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

    it('should show settings window if matched route target is settings', async () => {
      const params: InterceptRouteParams = {
        ...baseParams,
        path: '/settings/provider',
        url: 'app://host/settings/provider?active=provider&provider=ollama',
      };
      const matchedRoute = { targetWindow: BrowsersIdentifiers.settings, pathPrefix: '/settings' };
      const subPath = 'provider';
      (findMatchingRoute as Mock).mockReturnValue(matchedRoute);
      (extractSubPath as Mock).mockReturnValue(subPath);

      const result = await browserWindowsCtr.interceptRoute(params);

      expect(findMatchingRoute).toHaveBeenCalledWith(params.path);
      expect(extractSubPath).toHaveBeenCalledWith(params.path, matchedRoute.pathPrefix);
      expect(mockShowSettingsWindowWithTab).toHaveBeenCalledWith({
        searchParams: { active: 'provider', provider: 'ollama' },
        tab: subPath,
      });
      expect(result).toEqual({
        intercepted: true,
        path: params.path,
        source: params.source,
        subPath,
        targetWindow: matchedRoute.targetWindow,
      });
      expect(mockShow).not.toHaveBeenCalled();
    });

    it('should open target window if matched route target is not settings', async () => {
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
      expect(mockShow).toHaveBeenCalled();
      expect(result).toEqual({
        intercepted: true,
        path: params.path,
        source: params.source,
        targetWindow: matchedRoute.targetWindow,
      });
      expect(mockShowSettingsWindowWithTab).not.toHaveBeenCalled();
    });

    it('should return error if processing route interception fails for settings', async () => {
      const params: InterceptRouteParams = {
        ...baseParams,
        path: '/settings',
        url: 'app://host/settings?active=general',
      };
      const matchedRoute = { targetWindow: BrowsersIdentifiers.settings, pathPrefix: '/settings' };
      const subPath = undefined;
      const errorMessage = 'Processing error for settings';
      (findMatchingRoute as Mock).mockReturnValue(matchedRoute);
      (extractSubPath as Mock).mockReturnValue(subPath);
      mockShowSettingsWindowWithTab.mockRejectedValueOnce(new Error(errorMessage));

      const result = await browserWindowsCtr.interceptRoute(params);

      expect(mockShowSettingsWindowWithTab).toHaveBeenCalledWith({
        searchParams: { active: 'general' },
        tab: subPath,
      });
      expect(result).toEqual({
        error: errorMessage,
        intercepted: false,
        path: params.path,
        source: params.source,
      });
    });

    it('should return error if processing route interception fails for other window', async () => {
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
