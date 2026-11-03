const LEGACY_SETTINGS_DRIVE = /\/settings\/drive\/?$/;

/**
 * Where a legacy settings drive URL now lives: `/settings/drive` →
 * `/resource/sandbox-storage`, keeping any `/:workspaceSlug` prefix.
 */
export const legacySandboxStoragePath = (pathname: string): string =>
  pathname.replace(LEGACY_SETTINGS_DRIVE, '/resource/sandbox-storage');
