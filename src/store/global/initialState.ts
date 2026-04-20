import { type NavigateFunction } from 'react-router-dom';

import { type MigrationSQL, type MigrationTableItem } from '@/types/clientDB';
import { DatabaseLoadingState } from '@/types/clientDB';
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
  Video = 'video',
}

export enum ChatSettingsTabs {
  Chat = 'chat',
  Documents = 'documents',
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
  Advanced = 'advanced',
  /** @deprecated Use ServiceModel instead */
  Agent = 'agent',
  APIKey = 'apikey',
  Appearance = 'appearance',
  Billing = 'billing',
  /** @deprecated Use Appearance instead */
  ChatAppearance = 'chat-appearance',
  /** @deprecated Use Appearance instead */
  Common = 'common',
  Credits = 'credits',
  Creds = 'creds',
  Hotkey = 'hotkey',
  /** @deprecated Use ServiceModel instead */
  Image = 'image',
  LLM = 'llm',
  Memory = 'memory',
  Notification = 'notification',
  // business
  Plans = 'plans',
  Profile = 'profile',
  Provider = 'provider',
  Proxy = 'proxy',
  Referral = 'referral',
  Security = 'security',
  ServiceModel = 'service-model',
  Skill = 'skill',

  Stats = 'stats',
  Storage = 'storage',
  SystemTools = 'system-tools',
  /** @deprecated Use ServiceModel instead */
  TTS = 'tts',
  Usage = 'usage',
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
   * Agent Builder panel width
   */
  agentBuilderPanelWidth?: number;
  /**
   * number of agents (defaultList) to display
   */
  agentPageSize?: number;
  chatInputHeight?: number;
  disabledModelProvidersSortType?: string;
  disabledModelsSortType?: string;
  /**
   * IDs of banners/ads the user has dismissed. New banners use a new ID
   * so dismissing the current one does not hide future ones.
   */
  dismissedBannerIds?: string[];
  expandInputActionbar?: boolean;
  // which sessionGroup should expand
  expandSessionGroupKeys: string[];
  // which topicGroup should expand
  expandTopicGroupKeys?: string[];
  fileManagerViewMode?: 'list' | 'masonry';
  filePanelWidth: number;
  /**
   * Group Agent Builder panel width
   */
  groupAgentBuilderPanelWidth?: number;
  /**
   * Hidden sidebar sections
   */
  hiddenSidebarSections?: string[];
  hidePWAInstaller?: boolean;
  hideThreadLimitAlert?: boolean;
  hideTopicSharePrivacyWarning?: boolean;
  imagePanelWidth: number;
  imageTopicPanelWidth?: number;
  imageTopicViewMode?: 'grid' | 'list';
  /**
   * Do not enable PGLite on app initialization, only enable when user manually turns it on
   */
  isEnablePglite?: boolean;
  isShowCredit?: boolean;
  knowledgeBaseModalViewMode?: 'list' | 'masonry';
  language?: LocaleMode;
  /**
   * Remember user's last selected image generation model
   */
  lastSelectedImageModel?: string;
  /**
   * Remember user's last selected image generation provider
   */
  lastSelectedImageProvider?: string;
  lastSelectedVideoModel?: string;
  lastSelectedVideoProvider?: string;
  latestChangelogId?: string;
  leftPanelWidth: number;
  mobileShowPortal?: boolean;
  mobileShowTopic?: boolean;
  /**
   * ModelSwitchPanel grouping mode
   */
  modelSwitchPanelGroupMode?: 'byModel' | 'byProvider';
  /**
   * ModelSwitchPanel width
   */
  modelSwitchPanelWidth?: number;
  noWideScreen?: boolean;
  pageAgentPanelWidth?: number;
  /**
   * number of pages (documents) to display per page
   */
  pagePageSize?: number;
  portalWidth: number;
  readNotificationSlugs?: string[];
  /**
   * number of recent items to display
   */
  recentPageSize?: number;
  /**
   * Resource Manager column widths
   */
  resourceManagerColumnWidths?: {
    date: number;
    name: number;
    size: number;
  };
  showCommandMenu?: boolean;
  showFilePanel?: boolean;
  showHotkeyHelper?: boolean;
  showImagePanel?: boolean;
  showImageTopicPanel?: boolean;
  showLeftPanel?: boolean;
  showRightPanel?: boolean;
  showSystemRole?: boolean;
  showVideoPanel?: boolean;
  showVideoTopicPanel?: boolean;
  /**
   * Flat ordered list of sidebar items.
   */
  sidebarItems?: string[];
  /**
   * Legacy accordion-only ordering (recents/agent) from the pre-rework sidebar.
   * @deprecated Kept for one-time migration into `sidebarItems`.
   */
  sidebarSectionOrder?: string[];
  systemRoleExpandedMap: Record<string, boolean>;
  /**
   * Whether to display tokens in short format
   */
  tokenDisplayFormatShort?: boolean;
  /**
   * number of topics to display per page
   */
  topicPageSize?: number;
  videoPanelWidth: number;
  videoTopicPanelWidth?: number;
  videoTopicViewMode?: 'grid' | 'list';
  zenMode?: boolean;
}

export interface GlobalNavigationRef {
  current: NavigateFunction | null;
}

/** Fresh ref object — use for store init and resets so `initialState` is not aliased by nested mutation. */
export const createNavigationRef = (): GlobalNavigationRef => ({ current: null });

export interface GlobalState {
  hasNewVersion?: boolean;
  initClientDBError?: Error;
  initClientDBMigrations?: {
    sqls: MigrationSQL[];
    tableRecords: MigrationTableItem[];
  };

  initClientDBProcess?: { costTime?: number; phase: 'wasm' | 'dependencies'; progress: number };
  /**
   * Client database initialization state
   * Idle on startup, Ready when complete, Error on failure
   */
  initClientDBStage: DatabaseLoadingState;
  isMobile?: boolean;
  /**
   * Server version is too old, does not support /api/version endpoint
   * Need to prompt user to update server
   */
  isServerVersionOutdated?: boolean;
  isStatusInit?: boolean;
  latestVersion?: string;
  /** Imperative router navigate; see `NavigatorRegistrar` in `src/utils/router.tsx`. */
  navigationRef: GlobalNavigationRef;
  /**
   * Server version number, used to detect client-server version consistency
   */
  serverVersion?: string;
  sidebarKey: SidebarTabKey;
  status: SystemStatus;
  statusStorage: AsyncLocalStorage<SystemStatus>;
}

export const INITIAL_STATUS = {
  agentBuilderPanelWidth: 360,
  agentPageSize: 5,
  chatInputHeight: 64,
  recentPageSize: 5,
  disabledModelProvidersSortType: 'default',
  disabledModelsSortType: 'default',
  dismissedBannerIds: [],
  expandInputActionbar: true,
  expandSessionGroupKeys: [SessionDefaultGroup.Pinned, SessionDefaultGroup.Default],
  fileManagerViewMode: 'list' as const,
  filePanelWidth: 320,
  groupAgentBuilderPanelWidth: 360,
  hidePWAInstaller: false,
  hideThreadLimitAlert: false,
  hideTopicSharePrivacyWarning: false,
  imagePanelWidth: 320,
  imageTopicViewMode: 'grid' as const,
  imageTopicPanelWidth: 80,
  knowledgeBaseModalViewMode: 'list' as const,
  leftPanelWidth: 320,
  mobileShowTopic: false,
  modelSwitchPanelGroupMode: 'byProvider',
  modelSwitchPanelWidth: 460,
  noWideScreen: true,
  pageAgentPanelWidth: 360,
  pagePageSize: 20,
  portalWidth: 400,
  readNotificationSlugs: [],
  resourceManagerColumnWidths: {
    date: 160,
    name: 574,
    size: 140,
  },
  showCommandMenu: false,
  showFilePanel: true,
  showHotkeyHelper: false,
  showImagePanel: true,
  showImageTopicPanel: true,
  showLeftPanel: true,
  showRightPanel: true,
  showSystemRole: false,
  showVideoPanel: true,
  showVideoTopicPanel: true,
  systemRoleExpandedMap: {},
  tokenDisplayFormatShort: true,
  topicPageSize: 20,
  videoPanelWidth: 320,
  videoTopicViewMode: 'grid' as const,
  videoTopicPanelWidth: 80,
  zenMode: false,
} satisfies SystemStatus;

export const initialState: GlobalState = {
  initClientDBStage: DatabaseLoadingState.Idle,
  isMobile: false,
  isStatusInit: false,
  navigationRef: createNavigationRef(),
  sidebarKey: SidebarTabKey.Chat,
  status: INITIAL_STATUS,
  statusStorage: new AsyncLocalStorage('LOBE_SYSTEM_STATUS'),
};
