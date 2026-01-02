import type {
  ElectronAppState,
  WindowResizableParams,
  WindowSizeParams,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

/**
 * Service class for interacting with Electron's system-level information and actions.
 */
class ElectronSystemService {
  /**
   * Fetches the application state from the Electron main process.
   * This includes system information (platform, arch) and user-specific paths.
   * @returns {Promise<DesktopAppState>} A promise that resolves with the desktop app state.
   */
  async getAppState(): Promise<ElectronAppState> {
    // Calls the underlying IPC function to get data from the main process
    return ensureElectronIpc().system.getAppState();
  }

  async closeWindow(): Promise<void> {
    return ensureElectronIpc().windows.closeWindow();
  }

  async maximizeWindow(): Promise<void> {
    return ensureElectronIpc().windows.maximizeWindow();
  }

  async minimizeWindow(): Promise<void> {
    return ensureElectronIpc().windows.minimizeWindow();
  }

  async setWindowResizable(params: WindowResizableParams): Promise<void> {
    return ensureElectronIpc().windows.setWindowResizable(params);
  }

  async setWindowSize(params: WindowSizeParams): Promise<void> {
    return ensureElectronIpc().windows.setWindowSize(params);
  }

  async openExternalLink(url: string): Promise<void> {
    return ensureElectronIpc().system.openExternalLink(url);
  }

  showContextMenu = async (type: string, data?: any) => {
    return ensureElectronIpc().menu.showContextMenu({ data, type });
  };
}

// Export a singleton instance of the service
export const electronSystemService = new ElectronSystemService();
