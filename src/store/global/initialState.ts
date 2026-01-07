import type { NavigateFunction } from 'react-router-dom';

import { DatabaseLoadingState, type MigrationSQL, type MigrationTableItem } from '@/types/clientDB';
import { type LocaleMode } from '@/types/locale';
import { SessionDefaultGroup } from '@/types/session';
import { AsyncLocalStorage } from '@/utils/localStorage';

export enum SidebarTabKey {
  Chat = 'chat',
  Community = 'community',
  Home = 'home',
  Image = 'image',
  Knowledge = 'knowledge',
  Me = 'me',
  Memory = 'memory',
  Pages = 'pages',
  Resource = 'resource',
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
  APIKey = 'apikey',
  About = 'about',
  Agent = 'agent',
  ChatAppearance = 'chat-appearance',
  Common = 'common',
  Hotkey = 'hotkey',
  Image = 'image',
  LLM = 'llm',
  Memory = 'memory',
  Profile = 'profile',
  Provider = 'provider',
  Proxy = 'proxy',
  Security = 'security',
  Stats = 'stats',
  Storage = 'storage',
  TTS = 'tts',

  /* eslint-disable typescript-sort-keys/string-enum */
  // business
  Plans = 'plans',
  Funds = 'funds',
  Usage = 'usage',
  Billing = 'billing',
  Referral = 'referral',
  /* eslint-enable typescript-sort-keys/string-enum */
}

/**
 * @deprecated Use SettingsTabs instead
 */
export enum ProfileTabs {
  APIKey = 'apikey',
  Memory = 'memory',
  Profile = 'profile',
  Security = 'security',
  Stats = 'stats',
  Usage = 'usage',
}

export interface SystemStatus {
  /**
   * number of agents (defaultList) to display
   */
  agentPageSize?: number;
  chatInputHeight?: number;
  disabledModelProvidersSortType?: string;
  disabledModelsSortType?: string;
  expandInputActionbar?: boolean;
  // which sessionGroup should expand
  expandSessionGroupKeys: string[];
  // which topicGroup should expand
  expandTopicGroupKeys?: string[];
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
  knowledgeBaseModalViewMode?: 'list' | 'masonry';
  language?: LocaleMode;
  /**
   * 记住用户最后选择的图像生成模型
   */
  lastSelectedImageModel?: string;
  /**
   * Resource Manager column widths
   */
  resourceManagerColumnWidths?: {
    date: number;
    name: number;
    size: number;
  };
  /**
   * 记住用户最后选择的图像生成提供商
   */
  lastSelectedImageProvider?: string;
  latestChangelogId?: string;
  leftPanelWidth: number;
  mobileShowPortal?: boolean;
  mobileShowTopic?: boolean;
  /**
   * ModelSwitchPanel 的分组模式
   */
  modelSwitchPanelGroupMode?: 'byModel' | 'byProvider';
  /**
   * ModelSwitchPanel 的宽度
   */
  modelSwitchPanelWidth?: number;
  noWideScreen?: boolean;
  /**
   * number of pages (documents) to display per page
   */
  pagePageSize?: number;
  portalWidth: number;
  showCommandMenu?: boolean;
  showFilePanel?: boolean;
  showHotkeyHelper?: boolean;
  showImagePanel?: boolean;
  showImageTopicPanel?: boolean;
  showLeftPanel?: boolean;
  showRightPanel?: boolean;
  showSystemRole?: boolean;
  systemRoleExpandedMap: Record<string, boolean>;
  /**
   * 是否使用短格式显示 token
   */
  tokenDisplayFormatShort?: boolean;
  /**
   * number of topics to display per page
   */
  topicPageSize?: number;
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
  navigate?: NavigateFunction;
  sidebarKey: SidebarTabKey;
  status: SystemStatus;
  statusStorage: AsyncLocalStorage<SystemStatus>;
}

export const INITIAL_STATUS = {
  agentPageSize: 10,
  chatInputHeight: 64,
  disabledModelProvidersSortType: 'default',
  disabledModelsSortType: 'default',
  expandInputActionbar: true,
  expandSessionGroupKeys: [SessionDefaultGroup.Pinned, SessionDefaultGroup.Default],
  fileManagerViewMode: 'list' as const,
  filePanelWidth: 320,
  hideGemini2_5FlashImagePreviewChineseWarning: false,
  hidePWAInstaller: false,
  hideThreadLimitAlert: false,
  imagePanelWidth: 320,
  imageTopicPanelWidth: 80,
  knowledgeBaseModalViewMode: 'list' as const,
  leftPanelWidth: 320,
  mobileShowTopic: false,
  resourceManagerColumnWidths: {
    date: 160,
    name: 574,
    size: 140,
  },
  modelSwitchPanelGroupMode: 'byProvider',
  modelSwitchPanelWidth: 430,
  noWideScreen: true,
  pagePageSize: 20,
  portalWidth: 400,
  showCommandMenu: false,
  showFilePanel: true,
  showHotkeyHelper: false,
  showImagePanel: true,
  showImageTopicPanel: true,
  showLeftPanel: true,
  showRightPanel: true,
  showSystemRole: false,
  systemRoleExpandedMap: {},
  tokenDisplayFormatShort: true,
  topicPageSize: 20,
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
