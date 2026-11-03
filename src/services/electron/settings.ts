import {
  type NetworkProxySettings,
  type ShortcutUpdateResult,
  type WindowsShellMode,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class DesktopSettingsService {
  /**
   * Get app tray visibility
   */
  getAppTrayVisible = async () => {
    return ensureElectronIpc().tray.getAppTrayVisible();
  };

  /**
   * Get proxy settings
   */
  getProxySettings = async () => {
    return ensureElectronIpc().networkProxy.getDesktopSettings();
  };

  /**
   * Get shell settings for agent command execution (Windows shell selection)
   */
  getShellSettings = async () => {
    return ensureElectronIpc().shellCommand.getShellSettings();
  };

  /**
   * Set the Windows shell mode for agent command execution
   */
  setShellMode = async (mode: WindowsShellMode) => {
    return ensureElectronIpc().shellCommand.setShellMode({ mode });
  };

  /**
   * Set proxy settings
   */
  setSettings = async (data: Partial<NetworkProxySettings>) => {
    return ensureElectronIpc().networkProxy.setProxySettings(data);
  };

  /**
   * Set app tray visibility
   */
  setAppTrayVisible = async (visible: boolean) => {
    return ensureElectronIpc().tray.setAppTrayVisible(visible);
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
