import {
  type NetworkProxySettings,
  type ShortcutUpdateResult,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class DesktopSettingsService {
  /**
   * Get proxy settings
   */
  getProxySettings = async () => {
    return ensureElectronIpc().networkProxy.getDesktopSettings();
  };

  /**
   * Set proxy settings
   */
  setSettings = async (data: Partial<NetworkProxySettings>) => {
    return ensureElectronIpc().networkProxy.setProxySettings(data);
  };

  /**
   * Get desktop hotkey configuration
   */
  getDesktopHotkeys = async () => {
    return ensureElectronIpc().shortcut.getShortcutsConfig();
  };

  /**
   * Update desktop hotkey configuration
   */
  updateDesktopHotkey = async (id: string, accelerator: string): Promise<ShortcutUpdateResult> => {
    return ensureElectronIpc().shortcut.updateShortcutConfig({ accelerator, id });
  };

  /**
   * Test proxy connection
   */
  testProxyConnection = async (url: string) => {
    return ensureElectronIpc().networkProxy.testProxyConnection(url);
  };

  /**
   * Test specified proxy configuration
   */
  testProxyConfig = async (config: NetworkProxySettings, testUrl?: string) => {
    return ensureElectronIpc().networkProxy.testProxyConfig({ config, testUrl });
  };
}

export const desktopSettingsService = new DesktopSettingsService();
