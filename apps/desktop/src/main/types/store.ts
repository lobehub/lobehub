import type {
  DataSyncConfig,
  NetworkProxySettings,
  UpdateChannel,
} from '@lobechat/electron-client-ipc';

export interface ElectronMainStore {
  dataSyncConfig: DataSyncConfig;
  encryptedTokens: {
    accessToken?: string;
    expiresAt?: number;
    lastRefreshAt?: number;
    refreshToken?: string;
  };
  locale: string;
  networkProxy: NetworkProxySettings;
  shortcuts: Record<string, string>;
  storagePath: string;
  themeMode: 'dark' | 'light' | 'system';
  updateChannel: UpdateChannel;
}

export type StoreKey = keyof ElectronMainStore;
