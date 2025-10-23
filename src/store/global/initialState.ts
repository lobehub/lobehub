import type { ThemeMode } from 'antd-style';
import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

import { DatabaseLoadingState, MigrationSQL, MigrationTableItem } from '@/types/clientDB';
import { LocaleMode } from '@/types/locale';
import { SessionDefaultGroup } from '@/types/session';
import { AsyncLocalStorage } from '@/utils/localStorage';

export enum SidebarTabKey {
  Chat = 'chat',
  Discover = 'discover',
  Files = 'files',
  Image = 'image',
  Me = 'me',
  Setting = 'settings',
}

export enum ChatSettingsTabs {
  Chat = 'chat',
  Meta = 'meta',
  Modal = 'modal',
  Opening = 'opening',
  Plugin = 'plugin',
  Prompt = 'prompt',
  TTS = 'tts',
}

export enum GroupSettingsTabs {
  Chat = 'chat',
  Members = 'members',
  Settings = 'settings',
}

export enum SettingsTabs {
  About = 'about',
  Agent = 'agent',
  Common = 'common',
  Hotkey = 'hotkey',
  Image = 'image',
  LLM = 'llm',
  Provider = 'provider',
  Proxy = 'proxy',
  Storage = 'storage',
  SystemAgent = 'system-agent',
  TTS = 'tts',
}

export enum ProfileTabs {
  APIKey = 'apikey',
  Profile = 'profile',
  Security = 'security',
  Stats = 'stats',
}

export interface SystemStatus {
  chatInputHeight?: number;
  expandInputActionbar?: boolean;
  // which sessionGroup should expand
  expandSessionGroupKeys: string[];
  fileManagerViewMode?: 'list' | 'masonry';
  filePanelWidth: number;
  hideGemini2_5FlashImagePreviewChineseWarning?: boolean;
  hidePWAInstaller?: boolean;
  hideThreadLimitAlert?: boolean;
  imagePanelWidth: number;
  imageTopicPanelWidth?: number;
  /**
   * 应用初始化时不启用 PGLite，只有当用户手动开启时才启用
   */
  isEnablePglite?: boolean;
  isShowCredit?: boolean;
  language?: LocaleMode;
  /**
   * 记住用户最后选择的图像生成模型
   */
  lastSelectedImageModel?: string;
  /**
   * 记住用户最后选择的图像生成提供商
   */
  lastSelectedImageProvider?: string;
  latestChangelogId?: string;
  mobileShowPortal?: boolean;
  mobileShowTopic?: boolean;
  noWideScreen?: boolean;
  portalWidth: number;
  sessionsWidth: number;
  showChatSideBar?: boolean;
  showFilePanel?: boolean;
  showHotkeyHelper?: boolean;
  showImagePanel?: boolean;
  showImageTopicPanel?: boolean;
  showSessionPanel?: boolean;
  showSystemRole?: boolean;
  systemRoleExpandedMap: Record<string, boolean>;
  /**
   * theme mode
   */
  themeMode?: ThemeMode;
  zenMode?: boolean;
}

export interface GlobalState {
  hasNewVersion?: boolean;
  initClientDBError?: Error;
  initClientDBMigrations?: {
    sqls: MigrationSQL[];
    tableRecords: MigrationTableItem[];
  };

  initClientDBProcess?: { costTime?: number; phase: 'wasm' | 'dependencies'; progress: number };
  /**
   * 客户端数据库初始化状态
   * 启动时为 Idle，完成为 Ready，报错为 Error
   */
  initClientDBStage: DatabaseLoadingState;
  isMobile?: boolean;
  isStatusInit?: boolean;
  latestVersion?: string;
  router?: AppRouterInstance;
  sidebarKey: SidebarTabKey;
  status: SystemStatus;
  statusStorage: AsyncLocalStorage<SystemStatus>;
}

export const INITIAL_STATUS = {
  chatInputHeight: 64,
  expandInputActionbar: true,
  expandSessionGroupKeys: [SessionDefaultGroup.Pinned, SessionDefaultGroup.Default],
  fileManagerViewMode: 'list' as const,
  filePanelWidth: 320,
  hideGemini2_5FlashImagePreviewChineseWarning: false,
  hidePWAInstaller: false,
  hideThreadLimitAlert: false,
  imagePanelWidth: 320,
  imageTopicPanelWidth: 80,
  mobileShowTopic: false,
  noWideScreen: true,
  portalWidth: 400,
  sessionsWidth: 320,
  showChatSideBar: true,
  showFilePanel: true,
  showHotkeyHelper: false,
  showImagePanel: true,
  showImageTopicPanel: true,
  showSessionPanel: true,
  showSystemRole: false,
  systemRoleExpandedMap: {},
  themeMode: 'auto',
  zenMode: false,
} satisfies SystemStatus;

export const initialState: GlobalState = {
  initClientDBStage: DatabaseLoadingState.Idle,
  isMobile: false,
  isStatusInit: false,
  sidebarKey: SidebarTabKey.Chat,
  status: INITIAL_STATUS,
  statusStorage: new AsyncLocalStorage('LOBE_SYSTEM_STATUS'),
};
