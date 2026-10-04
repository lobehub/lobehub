import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const useSyncRecents = (): void => {
  const useFetchRecents = useHomeStore((s) => s.useFetchRecents);
  const isLogin = useUserStore(authSelectors.isLogin);
  const recentPageSize = useGlobalStore(systemStatusSelectors.recentPageSize);

  useFetchRecents(isLogin, recentPageSize);
};
