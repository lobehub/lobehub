/**
 * Tab identifiers for the workspace-scoped settings surface
 * (`/:workspaceSlug/settings/*`).
 *
 * Intentionally separate from `SettingsTabs` (personal settings) — the two
 * surfaces evolve independently and must not share enum members.
 */
export enum WorkspaceSettingsTabs {
  APIKey = 'apikey',
  Billing = 'billing',
  Credits = 'credits',
  Creds = 'creds',
  General = 'general',
  Members = 'members',
  Plans = 'plans',
  Provider = 'provider',
  ServiceModel = 'service-model',
  Skill = 'skill',
  Stats = 'stats',
  Storage = 'storage',
  Usage = 'usage',
}

export const DEFAULT_WORKSPACE_SETTINGS_TAB = WorkspaceSettingsTabs.General;
