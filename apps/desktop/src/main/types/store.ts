import type {
  CompletionSoundSettings,
  DataSyncConfig,
  ImessageBridgeConfig,
  NetworkProxySettings,
  UpdateChannel,
  WindowsShellMode,
} from '@lobechat/electron-client-ipc';
import type { HeteroSessionDirPref } from '@lobechat/types';

export interface ElectronMainStore {
  appTrayVisible: boolean;
  completionSound?: Partial<Omit<CompletionSoundSettings, 'systemSoundDisabled'>> & {
    directory?: string;
    files?: { file: string; mime: string }[];
  };
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
  gatewayDeviceId: string;
  gatewayEnabled: boolean;
  /**
   * Keep the computer from idle-sleeping while the device gateway connection
   * is enabled, so the device stays reachable from other clients. The display
   * can still sleep.
   */
  gatewayKeepAwake: boolean;
  /**
   * Device gateway address the user chose, used ahead of what the server
   * advertises. Absent by default. Older installs persisted the official
   * gateway here as a default, so that exact value reads as "not configured".
   */
  gatewayUrl?: string;
  /**
   * Legacy, account-less list of shared workspaces. An entry moves into
   * `gatewayWorkspaceEnrollmentsByAccount` once the server shows the signed-in
   * account enrolled it; until then it is kept but never restored.
   */
  gatewayWorkspaceEnrollments?: string[];
  /**
   * Workspaces this machine's personal gateway connection has been shared into
   * (via the `enrollWorkspace` device RPC), per `<serverKey>#<userId>`.
   * Persisted so an app restart can re-open the share connections without
   * re-sharing from the web UI — only for the account that shared them.
   */
  gatewayWorkspaceEnrollmentsByAccount: Record<string, string[]>;
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
  /**
   * Per-account memory of the workspace slug the main window was last in
   * (account = OIDC subject; no entry = personal). The next launch of that
   * account boots the window straight at `/{slug}` — no post-load redirect.
   * Written blind: a slug gone stale (membership revoked elsewhere) still
   * boots, and the renderer settles the real scope from there.
   */
  lastWorkspaceSlugByAccount: Record<string, string>;
  locale: string;
  localFileWorkspaceRoots: string[];
  networkProxy: NetworkProxySettings;
  pendingRestoreRoute: string;
  shortcuts: Record<string, string>;
  storagePath: string;
  themeMode: 'dark' | 'light' | 'system';
  updateChannel: UpdateChannel;
  /** Shell used for agent command execution on Windows (ignored elsewhere). */
  windowsShellMode: WindowsShellMode;
}

export type StoreKey = keyof ElectronMainStore;
