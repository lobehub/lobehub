/**
 * Tab identifiers for the workspace-scoped settings surface
 * (`/:workspaceSlug/settings/*`).
 *
 * Intentionally separate from `SettingsTabs` (personal settings) — the two
 * surfaces evolve independently and must not share enum members.
 */
export enum WorkspaceSettingsTabs {
  About = 'about',
  Advanced = 'advanced',
  APIKey = 'apikey',
  Appearance = 'appearance',
  AuditLog = 'audit-log',
  Billing = 'billing',
  Budget = 'budget',
  ChatPreference = 'chat-preference',
  Connector = 'connector',
  Credits = 'credits',
  Creds = 'credential',
  Devices = 'devices',
  Drive = 'drive',
  Environments = 'environments',
  General = 'general',
  Hotkey = 'hotkey',
  Integrations = 'integrations',
  Labels = 'labels',
  Labs = 'labs',
  Members = 'members',
  Messenger = 'messenger',
  Notification = 'notification',
  OAuthApps = 'oauth-apps',
  Plans = 'plans',
  Profile = 'profile',
  Provider = 'provider',
  ServiceModel = 'service-model',
  Skill = 'skill',
  Stats = 'statistics',
  Storage = 'storage',
  SubscriptionAccounts = 'subscription-accounts',
  Teams = 'teams',
  Usage = 'usage',
}

export const DEFAULT_WORKSPACE_SETTINGS_TAB = WorkspaceSettingsTabs.General;
