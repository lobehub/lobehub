import type {
  DataSyncConfig,
  ImessageBridgeConfig,
  NetworkProxySettings,
  UpdateChannel,
} from '@lobechat/electron-client-ipc';

export interface ElectronMainStore {
  appTrayVisible: boolean;
  dataSyncConfig: DataSyncConfig;
  encryptedTokens: {
    accessToken?: string;
    expiresAt?: number;
    lastRefreshAt?: number;
    refreshToken?: string;
  };
  gatewayDeviceDescription: string;
  gatewayDeviceId: string;
  gatewayDeviceName: string;
  gatewayEnabled: boolean;
  gatewayUrl: string;
  /**
   * Developer toggle: when true, hetero-agent (CC / Codex) CLI raw streams are
   * traced to disk even in packaged production builds. Dev builds always trace
   * regardless of this flag. Exposed via the Help menu checkbox.
   */
  heteroTracingEnabled: boolean;
  imessageBridgeConfigs: ImessageBridgeConfig[];
  locale: string;
  localFileWorkspaceRoots: string[];
  networkProxy: NetworkProxySettings;
  pendingRestoreRoute: string;
  shortcuts: Record<string, string>;
  storagePath: string;
  themeMode: 'dark' | 'light' | 'system';
  updateChannel: UpdateChannel;
}

export type StoreKey = keyof ElectronMainStore;
