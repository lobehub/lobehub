import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

export const useFetchSessions = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchSessions = useSessionStore((s) => s.useFetchSessions);

  useFetchSessions(true, isLogin);
};
