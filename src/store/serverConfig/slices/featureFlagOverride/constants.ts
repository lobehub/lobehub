export const DEV_FLAG_OVERRIDE_STORAGE_KEY = 'LOBE_DEV_FEATURE_FLAG_OVERRIDES';
export const DEV_FLAG_OVERRIDE_SCHEMA_VERSION = 1;

export interface PersistedDevFlagOverrides {
  overrides: Record<string, boolean>;
  version: number;
}
