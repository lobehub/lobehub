/**
 * 应用设置存储相关常量
 */
import { NetworkProxySettings } from '@lobechat/electron-client-ipc';

import { appStorageDir } from '@/const/dir';
import { DEFAULT_SHORTCUTS_CONFIG } from '@/shortcuts';
import { ElectronMainStore } from '@/types/store';

/**
 * 存储名称
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
 * 存储默认值
 */
export const STORE_DEFAULTS: ElectronMainStore = {
  dataSyncConfig: { storageMode: 'cloud' },
  encryptedTokens: {},
  locale: 'auto',
  networkProxy: defaultProxySettings,
  shortcuts: DEFAULT_SHORTCUTS_CONFIG,
  storagePath: appStorageDir,
  themeMode: 'auto',
};
