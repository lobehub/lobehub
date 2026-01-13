import type {
  InterceptRouteParams,
  OpenSettingsWindowOptions,
  WindowResizableParams,
  WindowSizeParams,
} from '@lobechat/electron-client-ipc';
import { findMatchingRoute } from '~common/routes';

import { AppBrowsersIdentifiers, WindowTemplateIdentifiers } from '@/appBrowsers';
import { getIpcContext } from '@/utils/ipc';

import { ControllerModule, IpcMethod, shortcut } from './index';

export default class BrowserWindowsCtr extends ControllerModule {
  static override readonly groupName = 'windows';

  @shortcut('showApp')
  async toggleMainWindow() {
    const mainWindow = this.app.browserManager.getMainWindow();
    mainWindow.toggleVisible();
  }

  @IpcMethod()
  async openSettingsWindow(options?: string | OpenSettingsWindowOptions) {
    const normalizedOptions: OpenSettingsWindowOptions =
      typeof options === 'string' || options === undefined
        ? { tab: typeof options === 'string' ? options : undefined }
        : options;

    console.log('[BrowserWindowsCtr] Received request to open settings', normalizedOptions);

    try {
      let fullPath: string;

      // If direct path is provided, use it directly
      if (normalizedOptions.path) {
        fullPath = normalizedOptions.path;
      } else {
        // Legacy support for tab and searchParams
        const tab = normalizedOptions.tab;
        fullPath = tab ? `/settings/${tab}` : '/settings/common';
      }

      const mainWindow = this.app.browserManager.getMainWindow();
      mainWindow.show();
      mainWindow.broadcast('navigate', { path: fullPath });

      return { success: true };
    } catch (error) {
      console.error('[BrowserWindowsCtr] Failed to open settings:', error);
      return { error: error.message, success: false };
    }
  }

  @IpcMethod()
  closeWindow() {
    this.withSenderIdentifier((identifier) => {
      this.app.browserManager.closeWindow(identifier);
    });
  }

  @IpcMethod()
  minimizeWindow() {
    this.withSenderIdentifier((identifier) => {
      this.app.browserManager.minimizeWindow(identifier);
    });
  }

  @IpcMethod()
  maximizeWindow() {
    this.withSenderIdentifier((identifier) => {
      this.app.browserManager.maximizeWindow(identifier);
    });
  }

  @IpcMethod()
  setWindowSize(params: WindowSizeParams) {
    this.withSenderIdentifier((identifier) => {
      this.app.browserManager.setWindowSize(identifier, params);
    });
  }

  @IpcMethod()
  setWindowResizable(params: WindowResizableParams) {
    this.withSenderIdentifier((identifier) => {
      this.app.browserManager.setWindowResizable(identifier, params.resizable);
    });
  }

  /**
   * Handle route interception requests
   * Responsible for handling route interception requests from the renderer process
   */
  @IpcMethod()
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
      await this.openTargetWindow(matchedRoute.targetWindow as AppBrowsersIdentifiers);

      return {
        intercepted: true,
        path,
        source,
        targetWindow: matchedRoute.targetWindow,
      };
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
  @IpcMethod()
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
  @IpcMethod()
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
  @IpcMethod()
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

  private withSenderIdentifier(fn: (identifier: string) => void) {
    const context = getIpcContext();
    if (!context) return;
    const identifier = this.app.browserManager.getIdentifierByWebContents(context.sender);
    if (!identifier) return;
    fn(identifier);
  }
}
