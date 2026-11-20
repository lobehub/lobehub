import { defineReplica, stableQueryKey } from '@/libs/replica';
import { discoverService } from '@/services/discover';
import { type DiscoverUserProfile } from '@/types/discover';

/**
 * A community profile read, addressed by the profile's username. Profile copy
 * is resolved in the viewer's language, so a locale switch is a different
 * entry — exactly like the SWR key it replaces (`[locale, username]`).
 *
 * The server answers `undefined` for a handle it does not know (a 404 profile).
 * The fetcher turns that into `null` so the slice's `isMissing` drops the entry
 * (memory and persisted row) — a deleted or renamed handle stops painting its
 * cached profile — and the surface falls back to "not found" once the sync
 * settles.
 */
export interface UserProfileParams {
  /** Current UI language; part of the entry so a locale switch refetches. */
  locale: string;
  username: string;
}

/** Entry key of one community profile (`userProfileMap[queryKey]`). */
export const userProfileQueryKey = (params: UserProfileParams): string => stableQueryKey(params);

/** A community user / organization profile (`userProfileMap[queryKey]`). */
export const userProfileResource = defineReplica<
  UserProfileParams,
  DiscoverUserProfile,
  DiscoverUserProfile | null
>({
  fetcher: async ({ username }) => (await discoverService.getUserInfo({ username })) ?? null,
  key: userProfileQueryKey,
  name: 'discoverUserProfile',
  storage: 'indexedDB',
  version: 1,
});
