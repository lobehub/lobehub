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
  Connector = 'connector',
  Credits = 'credits',
  Creds = 'credential',
  Devices = 'devices',
  General = 'general',
  Hotkey = 'hotkey',
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
  Usage = 'usage',
}

export const DEFAULT_WORKSPACE_SETTINGS_TAB = WorkspaceSettingsTabs.General;
