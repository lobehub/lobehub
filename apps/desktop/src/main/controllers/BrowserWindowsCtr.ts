import { InterceptRouteParams, OpenSettingsWindowOptions } from '@lobechat/electron-client-ipc';
import { extractSubPath, findMatchingRoute } from '~common/routes';

import {
  AppBrowsersIdentifiers,
  BrowsersIdentifiers,
  WindowTemplateIdentifiers,
} from '@/appBrowsers';
import { IpcClientEventSender } from '@/types/ipcClientEvent';

import { ControllerModule, ipcClientEvent, shortcut } from './index';

export default class BrowserWindowsCtr extends ControllerModule {
  @shortcut('showApp')
  async toggleMainWindow() {
    const mainWindow = this.app.browserManager.getMainWindow();
    mainWindow.toggleVisible();
  }

  @ipcClientEvent('openSettingsWindow')
  async openSettingsWindow(options?: string | OpenSettingsWindowOptions) {
    const normalizedOptions: OpenSettingsWindowOptions =
      typeof options === 'string' || options === undefined
        ? { tab: typeof options === 'string' ? options : undefined }
        : options;

    console.log('[BrowserWindowsCtr] Received request to open settings window', normalizedOptions);

    try {
      await this.app.browserManager.showSettingsWindowWithTab(normalizedOptions);

      return { success: true };
    } catch (error) {
      console.error('[BrowserWindowsCtr] Failed to open settings window:', error);
      return { error: error.message, success: false };
    }
  }

  @ipcClientEvent('closeWindow')
  closeWindow(data: undefined, sender: IpcClientEventSender) {
    this.app.browserManager.closeWindow(sender.identifier);
  }

  @ipcClientEvent('minimizeWindow')
  minimizeWindow(data: undefined, sender: IpcClientEventSender) {
    this.app.browserManager.minimizeWindow(sender.identifier);
  }

  @ipcClientEvent('maximizeWindow')
  maximizeWindow(data: undefined, sender: IpcClientEventSender) {
    this.app.browserManager.maximizeWindow(sender.identifier);
  }

  /**
   * Handle route interception requests
   * Responsible for handling route interception requests from the renderer process
   */
  @ipcClientEvent('interceptRoute')
  async interceptRoute(params: InterceptRouteParams) {
    const { path, source } = params;
    console.log(
      `[BrowserWindowsCtr] Received route interception request: ${path}, source: ${source}`,
    );

    // Find matching route configuration
    const matchedRoute = findMatchingRoute(path);

    // If no matching route found, return not intercepted
    if (!matchedRoute) {
      console.log(`[BrowserWindowsCtr] No matching route configuration found: ${path}`);
      return { intercepted: false, path, source };
    }

    console.log(
      `[BrowserWindowsCtr] Intercepted route: ${path}, target window: ${matchedRoute.targetWindow}`,
    );

    try {
      if (matchedRoute.targetWindow === BrowsersIdentifiers.settings) {
        const extractedSubPath = extractSubPath(path, matchedRoute.pathPrefix);
        const sanitizedSubPath =
          extractedSubPath && !extractedSubPath.startsWith('?') ? extractedSubPath : undefined;
        let searchParams: Record<string, string> | undefined;
        try {
          const url = new URL(params.url);
          const entries = Array.from(url.searchParams.entries());
          if (entries.length > 0) {
            searchParams = entries.reduce<Record<string, string>>((acc, [key, value]) => {
              acc[key] = value;
              return acc;
            }, {});
          }
        } catch (error) {
          console.warn(
            '[BrowserWindowsCtr] Failed to parse URL for settings route interception:',
            params.url,
            error,
          );
        }

        await this.app.browserManager.showSettingsWindowWithTab({
          searchParams,
          tab: sanitizedSubPath,
        });

        return {
          intercepted: true,
          path,
          source,
          subPath: sanitizedSubPath,
          targetWindow: matchedRoute.targetWindow,
        };
      } else {
        await this.openTargetWindow(matchedRoute.targetWindow as AppBrowsersIdentifiers);

        return {
          intercepted: true,
          path,
          source,
          targetWindow: matchedRoute.targetWindow,
        };
      }
    } catch (error) {
      console.error('[BrowserWindowsCtr] Error while processing route interception:', error);
      return {
        error: error.message,
        intercepted: false,
        path,
        source,
      };
    }
  }

  /**
   * Create a new multi-instance window
   */
  @ipcClientEvent('createMultiInstanceWindow')
  async createMultiInstanceWindow(params: {
    path: string;
    templateId: WindowTemplateIdentifiers;
    uniqueId?: string;
  }) {
    try {
      console.log('[BrowserWindowsCtr] Creating multi-instance window:', params);

      const result = this.app.browserManager.createMultiInstanceWindow(
        params.templateId,
        params.path,
        params.uniqueId,
      );

      // Show the window
      result.browser.show();

      return {
        success: true,
        windowId: result.identifier,
      };
    } catch (error) {
      console.error('[BrowserWindowsCtr] Failed to create multi-instance window:', error);
      return {
        error: error.message,
        success: false,
      };
    }
  }

  /**
   * Get all windows by template
   */
  @ipcClientEvent('getWindowsByTemplate')
  async getWindowsByTemplate(templateId: string) {
    try {
      const windowIds = this.app.browserManager.getWindowsByTemplate(templateId);
      return {
        success: true,
        windowIds,
      };
    } catch (error) {
      console.error('[BrowserWindowsCtr] Failed to get windows by template:', error);
      return {
        error: error.message,
        success: false,
      };
    }
  }

  /**
   * Close all windows by template
   */
  @ipcClientEvent('closeWindowsByTemplate')
  async closeWindowsByTemplate(templateId: string) {
    try {
      this.app.browserManager.closeWindowsByTemplate(templateId);
      return { success: true };
    } catch (error) {
      console.error('[BrowserWindowsCtr] Failed to close windows by template:', error);
      return {
        error: error.message,
        success: false,
      };
    }
  }

  /**
   * Open target window and navigate to specified sub-path
   */
  private async openTargetWindow(targetWindow: AppBrowsersIdentifiers) {
    // Ensure the window can always be created or reopened
    const browser = this.app.browserManager.retrieveByIdentifier(targetWindow);
    browser.show();
  }
}
