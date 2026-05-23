import {
  DEV_FLAG_OVERRIDE_SCHEMA_VERSION,
  DEV_FLAG_OVERRIDE_STORAGE_KEY,
  type PersistedDevFlagOverrides,
} from './constants';

const isDevEnv = () => process.env.NODE_ENV === 'development';

const isBrowser = () => typeof window !== 'undefined';

const sanitizeOverrides = (
  raw: unknown,
  knownKeys: ReadonlySet<string>,
): Record<string, boolean> => {
  if (typeof raw !== 'object' || raw === null) return {};

  const result: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!knownKeys.has(key)) {
      console.warn(`[DevFlagOverride] dropping unknown override key: ${key}`);
      continue;
    }
    if (typeof value !== 'boolean') {
      console.warn(`[DevFlagOverride] dropping non-boolean override for: ${key}`);
      continue;
    }
    result[key] = value;
  }
  return result;
};

export const readPersistedOverrides = (knownKeys: ReadonlySet<string>): Record<string, boolean> => {
  if (!isDevEnv() || !isBrowser()) return {};

  try {
    const raw = window.localStorage.getItem(DEV_FLAG_OVERRIDE_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as Partial<PersistedDevFlagOverrides>;
    if (parsed?.version !== DEV_FLAG_OVERRIDE_SCHEMA_VERSION) {
      console.warn('[DevFlagOverride] schema version mismatch, dropping persisted overrides');
      window.localStorage.removeItem(DEV_FLAG_OVERRIDE_STORAGE_KEY);
      return {};
    }

    return sanitizeOverrides(parsed.overrides, knownKeys);
  } catch (error) {
    console.warn('[DevFlagOverride] failed to read persisted overrides', error);
    return {};
  }
};

export const writePersistedOverrides = (overrides: Record<string, boolean>) => {
  if (!isDevEnv() || !isBrowser()) return;

  try {
    if (Object.keys(overrides).length === 0) {
      window.localStorage.removeItem(DEV_FLAG_OVERRIDE_STORAGE_KEY);
      return;
    }

    const payload: PersistedDevFlagOverrides = {
      overrides,
      version: DEV_FLAG_OVERRIDE_SCHEMA_VERSION,
    };
    window.localStorage.setItem(DEV_FLAG_OVERRIDE_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('[DevFlagOverride] failed to persist overrides', error);
  }
};

export const clearPersistedOverrides = () => {
  if (!isDevEnv() || !isBrowser()) return;

  try {
    window.localStorage.removeItem(DEV_FLAG_OVERRIDE_STORAGE_KEY);
  } catch (error) {
    console.warn('[DevFlagOverride] failed to clear persisted overrides', error);
  }
};
