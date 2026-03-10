import {
  type ElectronAppState,
  type WindowMinimumSizeParams,
  type WindowSizeParams,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

/**
 * Service class for interacting with Electron's system-level information and actions.
 */
class ElectronSystemService {
  private get ipc() {
    return ensureElectronIpc();
  }

  /**
   * Fetches the application state from the Electron main process.
   * This includes system information (platform, arch) and user-specific paths.
   * @returns {Promise<DesktopAppState>} A promise that resolves with the desktop app state.
   */
  async getAppState(): Promise<ElectronAppState> {
    // Calls the underlying IPC function to get data from the main process
    return this.ipc.system.getAppState();
  }

  async closeWindow(): Promise<void> {
    return this.ipc.windows.closeWindow();
  }

  async maximizeWindow(): Promise<void> {
    return this.ipc.windows.maximizeWindow();
  }

  async minimizeWindow(): Promise<void> {
    return this.ipc.windows.minimizeWindow();
  }

  async setWindowSize(params: WindowSizeParams): Promise<void> {
    return this.ipc.windows.setWindowSize(params);
  }

  async setWindowMinimumSize(params: WindowMinimumSizeParams): Promise<void> {
    return this.ipc.windows.setWindowMinimumSize(params);
  }

  async openExternalLink(url: string): Promise<void> {
    return this.ipc.system.openExternalLink(url);
  }

  async hasLegacyLocalDb(): Promise<boolean> {
    return this.ipc.system.hasLegacyLocalDb();
  }

  showContextMenu = async (type: string, data?: any) => {
    return this.ipc.menu.showContextMenu({ data, type });
  };

  /**
   * Open native folder picker dialog
   */
  async selectFolder(params?: {
    defaultPath?: string;
    title?: string;
  }): Promise<string | undefined> {
    return this.ipc.system.selectFolder(params);
  }
}

// Export a singleton instance of the service
export const electronSystemService = new ElectronSystemService();
