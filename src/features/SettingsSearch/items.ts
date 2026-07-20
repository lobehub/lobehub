import { SettingsTabs } from '@/store/global/initialState';

export interface SettingsSearchContext {
  disableEmailPassword: boolean;
  enableBusinessFeatures: boolean;
  enableComposio: boolean;
  enableGatewayMode: boolean;
  enableSTT: boolean;
  /** Whether the signed-in user has an email on their profile */
  hasEmail: boolean;
  hideDocs: boolean;
  isDesktop: boolean;
  isLogin: boolean;
  showAiImage: boolean;
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
  ns?: 'auth' | 'electron' | 'labs' | 'setting' | 'spend' | 'subscription';
  tab: SettingsTabs;
  /**
   * Extra visibility gate mirroring the target item's own render condition
   * (tab visibility is already handled via useCategory). Defaults to visible.
   */
  visible?: (ctx: SettingsSearchContext) => boolean;
}

/**
 * Canonical English keywords per tab, indexed in every locale. The localized
 * strings from TAB_SEARCH_KEYWORDS_KEYS are translations that usually replace
 * the English terms (zh-CN: `用量,消耗,配额…`), which made English queries like
 * `usage` or `skill` miss on non-English UIs. English is the lingua franca for
 * technical terms — it must always stay searchable; localized keywords enrich
 * on top of this floor.
 */
export const TAB_SEARCH_EN_KEYWORDS: Partial<Record<SettingsTabs, string[]>> = {
  [SettingsTabs.About]: ['about', 'version', 'changelog', 'feedback', 'help'],
  [SettingsTabs.Advanced]: ['advanced', 'developer', 'labs', 'experiment', 'beta'],
  [SettingsTabs.APIKey]: ['api key', 'apikey', 'token', 'secret'],
  [SettingsTabs.Appearance]: [
    'appearance',
    'theme',
    'dark mode',
    'light mode',
    'font',
    'language',
    'color',
  ],
  [SettingsTabs.Billing]: ['billing', 'payment', 'invoice', 'card', 'transaction'],
  [SettingsTabs.Connector]: ['connectors', 'integrations', 'mcp', 'oauth'],
  [SettingsTabs.Credits]: ['credits', 'balance', 'top up', 'recharge', 'buy credits'],
  [SettingsTabs.Creds]: ['credentials', 'secrets', 'oauth'],
  [SettingsTabs.Devices]: ['devices', 'sessions', 'logged in devices'],
  [SettingsTabs.Hotkey]: ['hotkey', 'shortcut', 'keyboard'],
  [SettingsTabs.Memory]: ['memory', 'memories', 'personalization'],
  [SettingsTabs.Messenger]: ['messenger', 'chat platform', 'bot'],
  [SettingsTabs.Notification]: ['notification', 'email', 'push', 'alerts'],
  [SettingsTabs.Plans]: ['subscription', 'plan', 'upgrade', 'pricing', 'membership'],
  [SettingsTabs.Profile]: [
    'profile',
    'account',
    'avatar',
    'username',
    'password',
    'email',
    'sign out',
    'logout',
  ],
  [SettingsTabs.Provider]: [
    'provider',
    'model',
    'llm',
    'api key',
    'apikey',
    'byok',
    'bring your own key',
    'endpoint',
  ],
  [SettingsTabs.Proxy]: ['proxy', 'network', 'connection'],
  [SettingsTabs.Referral]: ['referral', 'invite', 'rewards', 'bonus'],
  [SettingsTabs.ServiceModel]: [
    'service model',
    'model assignment',
    'topic naming',
    'translation',
    'tts',
    'voice',
    'speech',
    'image',
    'image generation',
    'embedding',
    'prompt rewrite',
    'suggestion',
  ],
  [SettingsTabs.Skill]: ['skill', 'skills', 'plugins', 'tools'],
  [SettingsTabs.Stats]: ['analytics', 'statistics', 'stats'],
  [SettingsTabs.Storage]: [
    'storage',
    'files',
    'import',
    'export',
    'backup',
    'reset',
    'clear data',
    'account deletion',
    'delete account',
  ],
  [SettingsTabs.SystemTools]: ['system tools', 'built-in tools'],
  [SettingsTabs.Usage]: ['usage', 'consumption', 'quota', 'spend', 'statistics'],
};

/**
 * Localized synonym keywords for tab-level entries (i18n keys in the `setting`
 * namespace, comma-separated values). Tab labels alone miss common synonyms —
 * e.g. searching "充值" (top up) should hit the Credits tab whose label is just
 * "积分", and "文件" (files) should hit Storage ("数据存储"). Each locale
 * carries its own synonym set, layered on top of TAB_SEARCH_EN_KEYWORDS.
 */
export const TAB_SEARCH_KEYWORDS_KEYS: Partial<Record<SettingsTabs, string>> = {
  [SettingsTabs.About]: 'settingsSearch.tabKeywords.about',
  [SettingsTabs.Advanced]: 'settingsSearch.tabKeywords.advanced',
  [SettingsTabs.APIKey]: 'settingsSearch.tabKeywords.apikey',
  [SettingsTabs.Appearance]: 'settingsSearch.tabKeywords.appearance',
  [SettingsTabs.Billing]: 'settingsSearch.tabKeywords.billing',
  [SettingsTabs.Connector]: 'settingsSearch.tabKeywords.connector',
  [SettingsTabs.Credits]: 'settingsSearch.tabKeywords.credits',
  [SettingsTabs.Creds]: 'settingsSearch.tabKeywords.creds',
  [SettingsTabs.Devices]: 'settingsSearch.tabKeywords.devices',
  [SettingsTabs.Hotkey]: 'settingsSearch.tabKeywords.hotkey',
  [SettingsTabs.Memory]: 'settingsSearch.tabKeywords.memory',
  [SettingsTabs.Messenger]: 'settingsSearch.tabKeywords.messenger',
  [SettingsTabs.Notification]: 'settingsSearch.tabKeywords.notification',
  [SettingsTabs.Plans]: 'settingsSearch.tabKeywords.plans',
  [SettingsTabs.Profile]: 'settingsSearch.tabKeywords.profile',
  [SettingsTabs.Provider]: 'settingsSearch.tabKeywords.provider',
  [SettingsTabs.Proxy]: 'settingsSearch.tabKeywords.proxy',
  [SettingsTabs.Referral]: 'settingsSearch.tabKeywords.referral',
  [SettingsTabs.ServiceModel]: 'settingsSearch.tabKeywords.serviceModel',
  [SettingsTabs.Skill]: 'settingsSearch.tabKeywords.skill',
  [SettingsTabs.Stats]: 'settingsSearch.tabKeywords.stats',
  [SettingsTabs.Storage]: 'settingsSearch.tabKeywords.storage',
  [SettingsTabs.SystemTools]: 'settingsSearch.tabKeywords.systemTools',
  [SettingsTabs.Usage]: 'settingsSearch.tabKeywords.usage',
};

/**
 * Hand-curated searchable settings entries below the tab level. Tab-level
 * entries are derived from `useCategory` at runtime and need no registration
 * here. Keep this list in sync when moving or removing the referenced items —
 * an entry whose tab is hidden for the current user is filtered out
 * automatically, but a stale anchor silently degrades to a plain tab switch.
 */
export const SETTINGS_SEARCH_ITEMS: SettingsSearchItem[] = [
  // Profile
  {
    anchor: 'profile-avatar',
    keywords: ['avatar', 'photo', 'profile picture'],
    labelKey: 'profile.avatar',
    ns: 'auth',
    tab: SettingsTabs.Profile,
  },
  {
    anchor: 'profile-full-name',
    keywords: ['full name', 'fullname', 'display name', 'nickname'],
    labelKey: 'profile.fullName',
    ns: 'auth',
    tab: SettingsTabs.Profile,
  },
  {
    anchor: 'profile-username',
    keywords: ['username', 'handle', 'user name'],
    labelKey: 'profile.username',
    ns: 'auth',
    tab: SettingsTabs.Profile,
  },
  {
    anchor: 'profile-interests',
    keywords: ['interests', 'topics', 'personalization'],
    labelKey: 'profile.interests',
    ns: 'auth',
    tab: SettingsTabs.Profile,
  },
  {
    anchor: 'profile-password',
    keywords: ['password', 'change password', 'set password', 'reset password'],
    labelKey: 'profile.password',
    ns: 'auth',
    tab: SettingsTabs.Profile,
    visible: (ctx) => ctx.isLogin && !ctx.isDesktop && !ctx.disableEmailPassword,
  },
  {
    anchor: 'profile-email',
    keywords: ['email', 'email address', 'update email', 'change email'],
    labelKey: 'profile.email',
    ns: 'auth',
    tab: SettingsTabs.Profile,
    visible: (ctx) => ctx.isLogin && ctx.hasEmail,
  },
  {
    anchor: 'profile-connected-accounts',
    keywords: [
      'connected accounts',
      'linked accounts',
      'sso',
      'oauth',
      'github',
      'google',
      'apple',
    ],
    labelKey: 'profile.sso.providers',
    ns: 'auth',
    tab: SettingsTabs.Profile,
    visible: (ctx) => ctx.isLogin && !ctx.isDesktop,
  },
  {
    anchor: 'profile-authorizations',
    keywords: ['authorizations', 'manage authorizations', 'composio', 'revoke access'],
    labelKey: 'profile.authorizations.title',
    ns: 'auth',
    tab: SettingsTabs.Profile,
    // The row additionally requires at least one connected Composio server —
    // async user data intentionally not mirrored; a miss degrades to a plain
    // tab switch.
    visible: (ctx) => ctx.enableComposio,
  },
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
    visible: (ctx) => ctx.enableGatewayMode,
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
  // Service Model
  {
    anchor: 'service-model-assignments',
    keywords: ['model assignment', 'topic naming', 'translation', 'default model'],
    labelKey: 'serviceModel.modelAssignments.title',
    tab: SettingsTabs.ServiceModel,
  },
  {
    anchor: 'service-model-memory',
    keywords: ['memory', 'embedding', 'vector'],
    labelKey: 'serviceModel.memoryModels.title',
    tab: SettingsTabs.ServiceModel,
  },
  {
    anchor: 'service-model-optional-features',
    keywords: ['follow up', 'input completion', 'prompt rewrite', 'suggestion'],
    labelKey: 'serviceModel.optionalFeatures.title',
    tab: SettingsTabs.ServiceModel,
  },
  {
    anchor: 'service-model-tts',
    keywords: ['tts', 'voice', 'speech', 'text to speech'],
    labelKey: 'settingTTS.openai.ttsModel',
    tab: SettingsTabs.ServiceModel,
    visible: (ctx) => ctx.enableSTT,
  },
  {
    anchor: 'service-model-image',
    descKey: 'settingImage.defaultCount.desc',
    keywords: ['image', 'image generation', 'ai image'],
    labelKey: 'settingImage.defaultCount.title',
    tab: SettingsTabs.ServiceModel,
    visible: (ctx) => ctx.showAiImage,
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
  {
    anchor: 'storage-account-deletion',
    descKey: 'accountDeletion.desc',
    keywords: ['delete account', 'deactivate', 'close account'],
    labelKey: 'accountDeletion.title',
    tab: SettingsTabs.Storage,
    // Rendered by the business AccountDeletion slot; the OSS default slot
    // renders nothing, so this gate matches the actual render condition only
    // for implementations that provide the slot (e.g. cloud).
    visible: (ctx) => ctx.enableBusinessFeatures,
  },
  // Proxy (the tab itself is desktop-only and filtered via useCategory)
  {
    anchor: 'proxy-enable',
    descKey: 'proxy.enableDesc',
    keywords: ['proxy', 'network'],
    labelKey: 'proxy.enable',
    ns: 'electron',
    tab: SettingsTabs.Proxy,
  },
  {
    anchor: 'proxy-auth',
    descKey: 'proxy.authDesc',
    keywords: ['authentication', 'username', 'password'],
    labelKey: 'proxy.auth',
    ns: 'electron',
    tab: SettingsTabs.Proxy,
  },
  {
    anchor: 'proxy-test',
    descKey: 'proxy.testDescription',
    keywords: ['test', 'connection', 'check'],
    labelKey: 'proxy.testUrl',
    ns: 'electron',
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
  // Business pages below are rendered by business slots (cloud implementation);
  // their tabs only appear when the business build provides them, so tab
  // visibility via useCategory is the effective gate — no per-item gate needed.
  // Billing
  {
    anchor: 'billing-summary',
    keywords: ['payment method', 'next payment', 'card'],
    labelKey: 'summary.title',
    ns: 'subscription',
    tab: SettingsTabs.Billing,
  },
  {
    anchor: 'billing-current-plan',
    keywords: ['plan', 'subscription', 'cancel'],
    labelKey: 'currentPlan.title',
    ns: 'subscription',
    tab: SettingsTabs.Billing,
  },
  {
    anchor: 'billing-history',
    keywords: ['invoice', 'receipt', 'payment history'],
    labelKey: 'billing.history',
    ns: 'subscription',
    tab: SettingsTabs.Billing,
  },
  // Credits
  {
    anchor: 'credits-balance',
    keywords: ['balance', 'credits'],
    labelKey: 'balance.title',
    ns: 'subscription',
    tab: SettingsTabs.Credits,
  },
  {
    anchor: 'credits-top-up',
    keywords: ['top up', 'topup', 'buy credits', 'recharge'],
    labelKey: 'credits.topUp.title',
    ns: 'subscription',
    tab: SettingsTabs.Credits,
  },
  {
    anchor: 'credits-cost-estimate-hint',
    descKey: 'credits.costEstimateHint.desc',
    keywords: ['cost estimate'],
    labelKey: 'credits.costEstimateHint.title',
    ns: 'subscription',
    tab: SettingsTabs.Credits,
  },
  {
    anchor: 'credits-auto-top-up',
    descKey: 'credits.autoTopUp.desc',
    keywords: ['auto top up', 'automatic recharge'],
    labelKey: 'credits.autoTopUp.title',
    ns: 'subscription',
    tab: SettingsTabs.Credits,
  },
  {
    anchor: 'credits-packages',
    keywords: ['package', 'budget'],
    labelKey: 'credits.packages.title',
    ns: 'subscription',
    tab: SettingsTabs.Credits,
  },
  // Plans
  {
    anchor: 'plans-model-pricing',
    keywords: ['model pricing', 'price'],
    labelKey: 'modelPricing.title',
    ns: 'subscription',
    tab: SettingsTabs.Plans,
  },
  {
    anchor: 'plans-qa',
    keywords: ['faq', 'question'],
    labelKey: 'qa.title',
    ns: 'subscription',
    tab: SettingsTabs.Plans,
  },
  // Referral
  {
    anchor: 'referral-invite-link',
    keywords: ['invite link', 'share'],
    labelKey: 'referral.inviteLink.title',
    ns: 'subscription',
    tab: SettingsTabs.Referral,
  },
  {
    anchor: 'referral-invite-code',
    keywords: ['invite code', 'referral code'],
    labelKey: 'referral.inviteCode.title',
    ns: 'subscription',
    tab: SettingsTabs.Referral,
  },
  {
    anchor: 'referral-stats',
    keywords: ['rewards', 'invites'],
    labelKey: 'referral.stats.title',
    ns: 'subscription',
    tab: SettingsTabs.Referral,
  },
  {
    anchor: 'referral-table',
    keywords: ['referral history'],
    labelKey: 'referral.table.title',
    ns: 'subscription',
    tab: SettingsTabs.Referral,
  },
  {
    anchor: 'referral-rules',
    descKey: 'referral.rules.description',
    keywords: ['rules'],
    labelKey: 'referral.rules.title',
    ns: 'subscription',
    tab: SettingsTabs.Referral,
  },
  // Usage
  {
    anchor: 'usage-spend',
    descKey: 'table.desc',
    keywords: ['spend', 'cost'],
    labelKey: 'table.title',
    ns: 'spend',
    tab: SettingsTabs.Usage,
  },
  {
    anchor: 'usage-overview',
    descKey: 'usage.credit.desc',
    keywords: ['usage', 'quota', 'credit'],
    labelKey: 'usage.credit.title',
    ns: 'subscription',
    tab: SettingsTabs.Usage,
  },
  // Notification
  {
    anchor: 'notification-email',
    keywords: ['email'],
    labelKey: 'notification.email.title',
    tab: SettingsTabs.Notification,
  },
  {
    anchor: 'notification-push',
    keywords: ['push'],
    labelKey: 'notification.push.title',
    tab: SettingsTabs.Notification,
  },
];
