import { type DiscoverUserProfile } from '@/types/discover';

import type { DiscoverStore } from '../store';

/**
 * Reader of the community profile replica. Takes the `queryKey` the profile
 * fetch hook returned, so a surface that asks for one profile never reads
 * another's value.
 */
const userProfile =
  (queryKey?: string) =>
  (s: DiscoverStore): DiscoverUserProfile | undefined =>
    queryKey ? s.userProfileMap[queryKey] : undefined;

export const userSelectors = { userProfile };
