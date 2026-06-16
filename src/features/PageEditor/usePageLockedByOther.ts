'use client';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import { usePageEditorStore } from './store';

/**
 * Whether the page's edit lock is held by *someone other than* the current user.
 *
 * Derived from the single source of truth — {@link lockHolderId} — compared
 * against the current user, rather than a separately-stored boolean. This
 * enforces the invariant "you can never be locked out by your own lock": no
 * matter how the holder was set (peek, acquire, or a realtime lock echo), the
 * holder being you always resolves to "not locked by other".
 */
export const usePageLockedByOther = (): boolean => {
  const lockHolderId = usePageEditorStore((s) => s.lockHolderId);
  const myUserId = useUserStore(userProfileSelectors.userId);

  return Boolean(lockHolderId) && lockHolderId !== myUserId;
};
