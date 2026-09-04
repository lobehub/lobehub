import { getActiveTabKey } from '@/hooks/useActiveTabKey';
import { useRouterStore } from '@/store/router';

export const useIsActiveTab = (key: string): boolean =>
  useRouterStore((state) => getActiveTabKey(state.location.pathname) === key);
