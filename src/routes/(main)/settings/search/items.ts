import { SettingsTabs } from '@/store/global/initialState';

export interface SettingsSearchContext {
  enableBusinessFeatures: boolean;
  hideDocs: boolean;
  isDesktop: boolean;
}

export interface SettingsSearchItem {
  /**
   * Unique anchor id, also used as the URL hash fragment. The target page must
   * wrap the matching label with `<SettingsSearchAnchor id={anchor}>`.
   */
  anchor: string;
  /** i18n key of the item description, in the same namespace as `labelKey` */
  descKey?: string;
  /** Extra untranslated match keywords (English) */
  keywords?: string[];
  /** i18n key of the item label */
  labelKey: string;
  /** i18n namespace of `labelKey` / `descKey`, defaults to `setting` */
  ns?: 'labs' | 'setting';
  tab: SettingsTabs;
  /**
   * Extra visibility gate mirroring the target item's own render condition
   * (tab visibility is already handled via useCategory). Defaults to visible.
   */
  visible?: (ctx: SettingsSearchContext) => boolean;
}

/**
 * Hand-curated searchable settings entries below the tab level. Tab-level
 * entries are derived from `useCategory` at runtime and need no registration
 * here. Keep this list in sync when moving or removing the referenced items —
 * an entry whose tab is hidden for the current user is filtered out
 * automatically, but a stale anchor silently degrades to a plain tab switch.
 */
export const SETTINGS_SEARCH_ITEMS: SettingsSearchItem[] = [
  // Appearance
  {
    anchor: 'appearance-theme-mode',
    keywords: ['theme', 'dark', 'light', 'mode'],
    labelKey: 'settingCommon.themeMode.title',
    tab: SettingsTabs.Appearance,
  },
  {
    anchor: 'appearance-language',
    keywords: ['language', 'locale', 'i18n'],
    labelKey: 'settingCommon.lang.title',
    tab: SettingsTabs.Appearance,
  },
  {
    anchor: 'appearance-animation',
    descKey: 'settingAppearance.animationMode.desc',
    keywords: ['animation', 'motion', 'transition'],
    labelKey: 'settingAppearance.animationMode.title',
    tab: SettingsTabs.Appearance,
  },
  {
    anchor: 'appearance-context-menu',
    descKey: 'settingAppearance.contextMenuMode.desc',
    keywords: ['context menu', 'right click'],
    labelKey: 'settingAppearance.contextMenuMode.title',
    tab: SettingsTabs.Appearance,
  },
  {
    anchor: 'appearance-response-language',
    descKey: 'settingCommon.responseLanguage.desc',
    keywords: ['response language', 'reply'],
    labelKey: 'settingCommon.responseLanguage.title',
    tab: SettingsTabs.Appearance,
  },
  {
    anchor: 'appearance-primary-color',
    keywords: ['color', 'accent'],
    labelKey: 'settingAppearance.primaryColor.title',
    tab: SettingsTabs.Appearance,
  },
  {
    anchor: 'appearance-neutral-color',
    keywords: ['color', 'gray', 'grey'],
    labelKey: 'settingAppearance.neutralColor.title',
    tab: SettingsTabs.Appearance,
  },
  {
    anchor: 'appearance-font-size',
    descKey: 'settingChatAppearance.fontSize.desc',
    keywords: ['font', 'size', 'text'],
    labelKey: 'settingChatAppearance.fontSize.title',
    tab: SettingsTabs.Appearance,
  },
  {
    anchor: 'appearance-app-tray',
    keywords: ['tray', 'menu bar', 'menubar'],
    labelKey: 'settingAppearance.appTray.title',
    tab: SettingsTabs.Appearance,
    visible: (ctx) => ctx.isDesktop,
  },
  // Advanced
  {
    anchor: 'advanced-dev-mode',
    descKey: 'settingCommon.devMode.desc',
    keywords: ['developer', 'debug', 'dev mode'],
    labelKey: 'settingCommon.devMode.title',
    tab: SettingsTabs.Advanced,
  },
  {
    anchor: 'advanced-gateway-mode',
    descKey: 'tab.advanced.gatewayMode.desc',
    keywords: ['gateway', 'agent runtime'],
    labelKey: 'tab.advanced.gatewayMode.title',
    tab: SettingsTabs.Advanced,
  },
  {
    anchor: 'advanced-update-channel',
    descKey: 'tab.advanced.updateChannel.desc',
    keywords: ['update', 'version', 'canary', 'stable'],
    labelKey: 'tab.advanced.updateChannel.title',
    tab: SettingsTabs.Advanced,
    visible: (ctx) => ctx.isDesktop,
  },
  {
    anchor: 'advanced-labs',
    keywords: ['labs', 'experiment', 'beta', 'preview'],
    labelKey: 'title',
    ns: 'labs',
    tab: SettingsTabs.Advanced,
  },
  // Storage
  {
    anchor: 'storage-export',
    keywords: ['export', 'backup'],
    labelKey: 'storage.actions.export.title',
    tab: SettingsTabs.Storage,
    visible: (ctx) => ctx.enableBusinessFeatures,
  },
  {
    anchor: 'storage-import',
    keywords: ['import', 'restore'],
    labelKey: 'storage.actions.import.title',
    tab: SettingsTabs.Storage,
  },
  {
    anchor: 'storage-reset',
    keywords: ['reset', 'clear', 'delete', 'danger'],
    labelKey: 'danger.reset.title',
    tab: SettingsTabs.Storage,
  },
  {
    anchor: 'storage-telemetry',
    keywords: ['telemetry', 'analytics', 'privacy', 'tracking'],
    labelKey: 'analytics.telemetry.title',
    tab: SettingsTabs.Storage,
    visible: (ctx) => ctx.hideDocs,
  },
  // Proxy (the tab itself is desktop-only and filtered via useCategory)
  {
    anchor: 'proxy-enable',
    descKey: 'proxy.enableDesc',
    keywords: ['proxy', 'network'],
    labelKey: 'proxy.enable',
    tab: SettingsTabs.Proxy,
  },
  {
    anchor: 'proxy-auth',
    descKey: 'proxy.authDesc',
    keywords: ['authentication', 'username', 'password'],
    labelKey: 'proxy.auth',
    tab: SettingsTabs.Proxy,
  },
  {
    anchor: 'proxy-test',
    descKey: 'proxy.testDescription',
    keywords: ['test', 'connection', 'check'],
    labelKey: 'proxy.testUrl',
    tab: SettingsTabs.Proxy,
  },
  // Hotkey
  {
    anchor: 'hotkey-essential',
    keywords: ['shortcut', 'keyboard', 'hotkey'],
    labelKey: 'hotkey.group.essential',
    tab: SettingsTabs.Hotkey,
  },
  {
    anchor: 'hotkey-conversation',
    keywords: ['shortcut', 'keyboard', 'chat'],
    labelKey: 'hotkey.group.conversation',
    tab: SettingsTabs.Hotkey,
  },
  {
    anchor: 'hotkey-desktop',
    keywords: ['shortcut', 'keyboard', 'global'],
    labelKey: 'hotkey.group.desktop',
    tab: SettingsTabs.Hotkey,
    visible: (ctx) => ctx.isDesktop,
  },
];
