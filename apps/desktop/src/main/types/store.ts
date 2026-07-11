import type {
  DataSyncConfig,
  ImessageBridgeConfig,
  NetworkProxySettings,
  UpdateChannel,
} from '@lobechat/electron-client-ipc';
import type { HeteroSessionDirPref } from '@lobechat/types';

export interface ElectronMainStore {
  appTrayVisible: boolean;
  dataSyncConfig: DataSyncConfig;
  /**
   * Explicit completion state for the multi-step desktop onboarding flow.
   * Undefined preserves the legacy behavior for users who completed onboarding
   * before this marker existed.
   */
  desktopOnboardingCompleted?: boolean;
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
   * Workspaces this machine's personal gateway connection has been shared into
   * (via the `enrollWorkspace` device RPC). Persisted so an app restart can
   * re-open the workspace share connections without re-sharing from the web UI.
   */
  gatewayWorkspaceEnrollments: string[];
  /**
   * Developer toggle: when true, hetero-agent (CC / Codex) CLI raw streams are
   * traced to disk even in packaged production builds. Dev builds always trace
   * regardless of this flag. Exposed via the Help menu checkbox.
   */
  /**
   * Per-directory import preferences for local CLI session import, keyed by
   * `${source}::${workingDirectory}`. Machine-local by nature (paths only make
   * sense on this device), so it lives here instead of the server DB.
   */
  heteroSessionDirPrefs: Record<string, HeteroSessionDirPref>;
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
