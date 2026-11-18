import { useDiscoverStore } from '@/store/discover';
import { marketSelectors } from '@/store/discover/selectors';

/**
 * The Market profile of a username (typically `userInfo.sub`), read from the
 * discover `marketUserProfile` replica: a reload paints the last confirmed
 * profile before the network answers. Only public profile fields persist; the
 * Market session and its tokens never enter the replica.
 *
 * `data` is `undefined` while unloaded and when the account has no Market
 * profile yet (the server answers NOT_FOUND, which is not retried).
 */
export const useMarketUserProfile = (username: string | null | undefined) => {
  const useSync = useDiscoverStore((s) => s.useMarketUserProfile);
  const { queryKey, revalidate, ...sync } = useSync(username);
  const data = useDiscoverStore(marketSelectors.userProfile(queryKey));

  return { ...sync, data, mutate: revalidate, revalidate };
};
