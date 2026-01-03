import {
  type DataSyncConfig,
  type ElectronAppState,
  type NetworkProxySettings,
} from '@lobechat/electron-client-ipc';

export type RemoteServerError = 'CONFIG_ERROR' | 'AUTH_ERROR' | 'DISCONNECT_ERROR';

export const defaultProxySettings: NetworkProxySettings = {
  enableProxy: false,
  proxyBypass: 'localhost, 127.0.0.1, ::1',
  proxyPort: '',
  proxyRequireAuth: false,
  proxyServer: '',
  proxyType: 'http',
};

export interface ElectronState {
  appState: ElectronAppState;
  dataSyncConfig: DataSyncConfig;
  desktopHotkeys: Record<string, string>;
  isAppStateInit?: boolean;
  isConnectingServer?: boolean;
  isDesktopHotkeysInit: boolean;
  isInitRemoteServerConfig: boolean;
  isSyncActive?: boolean;
  proxySettings: NetworkProxySettings;
  remoteServerSyncError?: { message?: string; type: RemoteServerError };
}

export const initialState: ElectronState = {
  appState: {},
  dataSyncConfig: { storageMode: 'cloud' },
  desktopHotkeys: {},
  isAppStateInit: false,
  isConnectingServer: false,
  isDesktopHotkeysInit: false,
  isInitRemoteServerConfig: false,
  isSyncActive: false,
  proxySettings: defaultProxySettings,
};
