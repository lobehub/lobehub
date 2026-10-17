import { UserPreferenceSchema } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import type { PartialDeep } from 'type-fest';

import { LocalStorageQueryProjectionStorage } from '@/libs/queryProjectionStorage';
import type { LobeUser, UserPreference } from '@/types/user';
import type { UserSettings } from '@/types/user/settings';

export interface UserDisplaySnapshot {
  avatar?: string;
  email?: string;
  firstName?: string;
  fullName?: string;
  interests?: string[];
  lastName?: string;
  preference?: UserPreference;
  settings?: PartialDeep<UserSettings>;
  username?: string;
}

/**
 * Only profile and settings fields may be restored before the authoritative
 * user-state response. Entitlement and onboarding state (`isFreePlan`,
 * `subscriptionPlan`, `onboarding`, …) stay network-only, and settings keep an
 * allowlist of sections: `keyVaults` and `market` hold credentials, and the
 * server passes unknown sections through.
 */
const storage = new LocalStorageQueryProjectionStorage<UserDisplaySnapshot>({
  namespace: 'lobehub:user-display-snapshot:v1',
});
const snapshotKey = (userId: string) => ({ queryKey: 'display', scope: userId });

const PROFILE_FIELDS = [
  'avatar',
  'email',
  'firstName',
  'fullName',
  'lastName',
  'username',
] as const;

const SETTINGS_SECTIONS = [
  'defaultAgent',
  'general',
  'hotkey',
  'image',
  'languageModel',
  'memory',
  'notification',
  'systemAgent',
  'tool',
  'tts',
] as const satisfies readonly (keyof UserSettings)[];

const sanitizeSettings = (value: unknown): PartialDeep<UserSettings> | undefined => {
  if (!isRecord(value)) return undefined;

  const settings: Record<string, unknown> = {};
  for (const section of SETTINGS_SECTIONS) {
    if (isRecord(value[section])) settings[section] = value[section];
  }

  return Object.keys(settings).length > 0 ? (settings as PartialDeep<UserSettings>) : undefined;
};

const sanitizeSnapshot = (value: unknown): UserDisplaySnapshot | undefined => {
  if (!isRecord(value)) return undefined;

  const snapshot: UserDisplaySnapshot = {};

  for (const field of PROFILE_FIELDS) {
    if (typeof value[field] === 'string') snapshot[field] = value[field];
  }

  if (Array.isArray(value.interests)) {
    snapshot.interests = value.interests.filter((item) => typeof item === 'string');
  }

  if (value.preference !== undefined) {
    const result = UserPreferenceSchema.safeParse(value.preference);
    if (result.success) snapshot.preference = result.data;
  }

  const settings = sanitizeSettings(value.settings);
  if (settings) snapshot.settings = settings;

  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
};

export const userFromDisplaySnapshot = (
  snapshot: UserDisplaySnapshot | undefined,
  identity: LobeUser,
): LobeUser => ({
  ...(snapshot && {
    avatar: snapshot.avatar,
    email: snapshot.email,
    firstName: snapshot.firstName,
    fullName: snapshot.fullName,
    interests: snapshot.interests,
    latestName: snapshot.lastName,
    username: snapshot.username,
  }),
  ...identity,
});

/**
 * Read the small, user-scoped display snapshot used to bridge the auth and
 * user-state requests during a cold boot.
 *
 * The caller must provide the exact authenticated user id. No last-used user
 * fallback is allowed because this data can contain private profile settings.
 */
export const readUserDisplaySnapshot = (userId: string): UserDisplaySnapshot | undefined => {
  if (!userId) return undefined;
  return sanitizeSnapshot(storage.getSync(snapshotKey(userId))?.data);
};

/**
 * Persist only the allowlisted fields needed before the authoritative user
 * state request resolves. A partial update is merged with the existing entry;
 * a full user-state response passes `replace` so fields the server cleared do
 * not survive from an earlier write.
 */
export const writeUserDisplaySnapshot = (
  userId: string | undefined,
  snapshot: UserDisplaySnapshot,
  { replace = false }: { replace?: boolean } = {},
): void => {
  if (!userId) return;

  const sanitized = sanitizeSnapshot(snapshot);
  if (!sanitized) return;

  // Best-effort: a failed write only costs the next cold start its snapshot.
  storage
    .set(snapshotKey(userId), {
      data: replace ? sanitized : { ...readUserDisplaySnapshot(userId), ...sanitized },
      updatedAt: Date.now(),
    })
    .catch((error) => {
      console.error('[displaySnapshot] failed to persist the display snapshot', error);
    });
};

/**
 * Remove the persisted display snapshot for one user after that user's session
 * has been successfully signed out.
 */
export const clearUserDisplaySnapshot = (userId: string | undefined): void => {
  if (!userId) return;
  storage.remove(snapshotKey(userId)).catch((error) => {
    console.error('[displaySnapshot] failed to clear the display snapshot', error);
  });
};
