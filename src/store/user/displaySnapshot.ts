import { UserPreferenceSchema } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import { LocalStorageQueryProjectionStorage } from '@/libs/queryProjectionStorage';
import type { UserPreference } from '@/types/user';

export interface UserDisplaySnapshot {
  avatar?: string;
  preference?: UserPreference;
}

/**
 * Only display fields may be restored before the authoritative user-state response.
 * Persisting that whole response would also restore stale entitlement and onboarding state.
 */
const storage = new LocalStorageQueryProjectionStorage<UserDisplaySnapshot>({
  namespace: 'lobehub:user-display-snapshot:v1',
});
const snapshotKey = (userId: string) => ({ queryKey: 'display', scope: userId });

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
  if (!userId) return undefined;
  return sanitizeSnapshot(storage.getSync(snapshotKey(userId))?.data);
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
  if (!userId) return;

  const sanitized = sanitizeSnapshot(snapshot);
  if (!sanitized) return;

  void storage.set(snapshotKey(userId), {
    data: { ...readUserDisplaySnapshot(userId), ...sanitized },
    updatedAt: Date.now(),
  });
};

/**
 * Remove the persisted display snapshot for one user after that user's session
 * has been successfully signed out.
 */
export const clearUserDisplaySnapshot = (userId: string | undefined): void => {
  if (!userId) return;
  void storage.remove(snapshotKey(userId));
};
