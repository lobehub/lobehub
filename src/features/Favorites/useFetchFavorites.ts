import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * Sync the member's favorites into the home store. Mounted by the sidebar
 * section and every favorite toggle; the replica dedupes concurrent mounts and
 * swaps the list when the workspace changes.
 */
export const useFetchFavorites = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetch = useHomeStore((s) => s.useFetchFavorites);

  return useFetch(isLogin === true);
};
