import { useEffect } from 'react';

import { drainLocalWorktreeCleanups } from '@/services/ownedWorktree';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

/** Let startup settle first; the drain is housekeeping, not on the critical path. */
const STARTUP_DRAIN_DELAY_MS = 5000;

/**
 * Once per signed-in session on desktop start: remove the app-created
 * worktrees of topics archived or trashed while this desktop could not be
 * reached (gateway off, or never registered with it). Runs over IPC in the
 * main process; the server keeps each one from running twice.
 */
export const useDrainWorktreeCleanups = () => {
  const isLogin = useUserStore(authSelectors.isLogin);

  useEffect(() => {
    if (!isLogin) return;
    const timer = setTimeout(() => void drainLocalWorktreeCleanups(), STARTUP_DRAIN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isLogin]);
};
