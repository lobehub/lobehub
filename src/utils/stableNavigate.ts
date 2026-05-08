import type { NavigateFunction } from 'react-router-dom';

import { useGlobalStore } from '@/store/global';

/** Current imperative navigate from the ref synced by `NavigatorRegistrar` (non-React call sites). */
export function getStableNavigate(): NavigateFunction | null {
  return useGlobalStore.getState().navigationRef.current;
}
