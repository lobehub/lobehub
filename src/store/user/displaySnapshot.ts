import { UserPreferenceSchema } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import type { UserPreference } from '@/types/user';

const USER_DISPLAY_SNAPSHOT_SCHEMA_VERSION = 1;
const USER_DISPLAY_SNAPSHOT_STORAGE_KEY_PREFIX = 'lobehub:user-display-snapshot:v1:';

export interface UserDisplaySnapshot {
  avatar?: string;
  preference?: UserPreference;
}

interface PersistedUserDisplaySnapshot {
  snapshot: UserDisplaySnapshot;
  userId: string;
  version: number;
}

const isBrowser = (): boolean => typeof window !== 'undefined';

const getStorageKey = (userId: string): string =>
  `${USER_DISPLAY_SNAPSHOT_STORAGE_KEY_PREFIX}${encodeURIComponent(userId)}`;

const sanitizeSnapshot = (value: unknown): UserDisplaySnapshot | undefined => {
  if (!isRecord(value)) return undefined;

  const snapshot: UserDisplaySnapshot = {};

  if (typeof value.avatar === 'string') snapshot.avatar = value.avatar;

  if (value.preference !== undefined) {
    const result = UserPreferenceSchema.safeParse(value.preference);
    if (result.success) snapshot.preference = result.data;
  }

  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
};

/**
 * Read the small, user-scoped display snapshot used to bridge the auth and
 * user-state requests during a cold boot.
 *
 * The caller must provide the exact authenticated user id. No last-used user
 * fallback is allowed because this data can contain private profile settings.
 */
export const readUserDisplaySnapshot = (userId: string): UserDisplaySnapshot | undefined => {
  if (!isBrowser() || !userId) return undefined;

  try {
    const raw = window.localStorage.getItem(getStorageKey(userId));
    if (!raw) return undefined;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return undefined;
    if (parsed.version !== USER_DISPLAY_SNAPSHOT_SCHEMA_VERSION) return undefined;
    if (parsed.userId !== userId) return undefined;

    return sanitizeSnapshot(parsed.snapshot);
  } catch {
    return undefined;
  }
};

/**
 * Persist only the display fields needed before the authoritative user state
 * request resolves. The value is merged with the existing user entry so a
 * partial update cannot discard the other display field.
 */
export const writeUserDisplaySnapshot = (
  userId: string | undefined,
  snapshot: UserDisplaySnapshot,
): void => {
  if (!isBrowser() || !userId) return;

  const sanitized = sanitizeSnapshot(snapshot);
  if (!sanitized) return;

  try {
    const previous = readUserDisplaySnapshot(userId);
    const payload: PersistedUserDisplaySnapshot = {
      snapshot: {
        ...previous,
        ...sanitized,
      },
      userId,
      version: USER_DISPLAY_SNAPSHOT_SCHEMA_VERSION,
    };

    window.localStorage.setItem(getStorageKey(userId), JSON.stringify(payload));
  } catch {
    // localStorage is best-effort and may be unavailable in restricted browsers.
  }
};

/**
 * Remove the persisted display snapshot for one user after that user's session
 * has been successfully signed out.
 */
export const clearUserDisplaySnapshot = (userId: string | undefined): void => {
  if (!isBrowser() || !userId) return;

  try {
    window.localStorage.removeItem(getStorageKey(userId));
  } catch {
    // localStorage is best-effort and may be unavailable in restricted browsers.
  }
};
