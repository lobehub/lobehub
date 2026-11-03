import {
  type DetectAppsResult,
  type OpenInAppParams,
  type OpenInAppResult,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

/**
 * Service class for interacting with Electron's "Open in App" capabilities,
 * which detects installed editors / file managers / terminals and launches
 * them against a working directory.
 */
class ElectronOpenInAppService {
  private get ipc() {
    return ensureElectronIpc();
  }

  /**
   * Detect which supported apps are installed on the current platform.
   * The main process caches results for the lifetime of the Electron main process.
   */
  async detectApps(): Promise<DetectAppsResult> {
    return this.ipc.openInApp.detectApps();
  }

  /**
   * Launch the given app with `path` as its target (typically the agent
   * working directory).
   */
  async openInApp(params: OpenInAppParams): Promise<OpenInAppResult> {
    return this.ipc.openInApp.openInApp(params);
  }
}

// Export a singleton instance of the service
export const electronOpenInAppService = new ElectronOpenInAppService();
