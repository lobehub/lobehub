/**
 * Application settings storage related constants
 */
import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';

import { appStorageDir } from '@/const/dir';
import { UPDATE_CHANNEL } from '@/modules/updater/configs';
import { DEFAULT_SHORTCUTS_CONFIG } from '@/shortcuts';
import type { ElectronMainStore } from '@/types/store';

/**
 * Storage name
 */
export const STORE_NAME = 'lobehub-settings';

export const defaultProxySettings: NetworkProxySettings = {
  enableProxy: false,
  proxyBypass: 'localhost, 127.0.0.1, ::1',
  proxyPort: '',
  proxyRequireAuth: false,
  proxyServer: '',
  proxyType: 'http',
};

/**
 * Storage default values
 */
export const STORE_DEFAULTS: ElectronMainStore = {
  dataSyncConfig: { storageMode: 'cloud' },
  encryptedTokens: {},
  locale: 'auto',
  networkProxy: defaultProxySettings,
  shortcuts: DEFAULT_SHORTCUTS_CONFIG,
  storagePath: appStorageDir,
  themeMode: 'system',
  updateChannel: UPDATE_CHANNEL,
};
