/**
 * Application settings storage related constants
 */
import { DEFAULT_ELECTRON_DESKTOP_SHORTCUTS } from '@lobechat/const/desktopGlobalShortcuts';
import type { NetworkProxySettings } from '@lobechat/electron-client-ipc';

import { getAppStorageDir } from '@/const/dir';
import { getDesktopEnv } from '@/env';
import { UPDATE_CHANNEL } from '@/modules/updater/configs';
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
 * Storage default values.
 *
 * A function rather than a constant because `storagePath` is derived from the
 * userData directory, which `pre-app-init.ts` rewrites for a branded build. Read
 * at module evaluation it resolved before that rewrite and defaulted every fresh
 * install's local files into `lobehub-desktop-dev`. `StoreManager` calls this
 * from its constructor, long after the app has been named.
 */
export const getStoreDefaults = (): ElectronMainStore => ({
  appTrayVisible: true,
  dataSyncConfig: { storageMode: 'cloud' },
  encryptedTokens: {},
  gatewayDeviceId: '',
  // Build-time default, still overridable at runtime through the store — a
  // distribution that runs no gateway of its own must not have every install
  // opening a socket to the official one. See DEVICE_GATEWAY_ENABLED in env.ts.
  //
  // The URL below deliberately stays a plain constant: DEVICE_GATEWAY_URL is
  // already consulted ahead of the store in `gatewayConnectionSrv.getGatewayUrl`,
  // so reading it here too would be a second, lower-priority copy of the same
  // decision — and the two would drift the first time one of them moved.
  gatewayEnabled: getDesktopEnv().DEVICE_GATEWAY_ENABLED,
  gatewayUrl: 'https://device-gateway.lobehub.com',
  gatewayWorkspaceEnrollments: [],
  heteroSessionDirPrefs: {},
  heteroTracingEnabled: false,
  imessageBridgeConfigs: [],
  lastWorkspaceSlugByAccount: {},
  locale: 'auto',
  localFileWorkspaceRoots: [],
  networkProxy: defaultProxySettings,
  pendingRestoreRoute: '',
  shortcuts: DEFAULT_ELECTRON_DESKTOP_SHORTCUTS,
  storagePath: getAppStorageDir(),
  themeMode: 'system',
  updateChannel: UPDATE_CHANNEL,
  windowsShellMode: 'auto',
});
