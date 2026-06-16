'use client';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import { usePageEditorStore } from './store';

interface LockedByOtherSessionInput {
  /** User id of the current holder (null when unlocked). */
  holderId: string | null | undefined;
  /** Edit-session id of the current holder (null for legacy/unknown). */
  holderOwnerId: string | null | undefined;
  /** This page instance's own edit-session id. */
  myOwnerId: string | undefined;
  myUserId: string | undefined;
}

/**
 * Pure decision for "is the lock held by someone other than *this* session".
 *
 * - Different user → always locked.
 * - Same user, a *different* edit session (e.g. a second tab) → locked. The
 *   server lock is session-scoped, so the other tab really would block writes.
 * - Same user, same session / no holder → not locked.
 * - Legacy holder with no `holderOwnerId` (a pre-upgrade lock during a rolling
 *   deploy), or our own session id not yet known → treated as ours, preserving
 *   the invariant "you can never be locked out by your own lock".
 */
export const isLockedByOtherSession = ({
  holderId,
  holderOwnerId,
  myOwnerId,
  myUserId,
}: LockedByOtherSessionInput): boolean => {
  if (!holderId) return false;
  if (holderId !== myUserId) return true;

  return Boolean(holderOwnerId && myOwnerId && holderOwnerId !== myOwnerId);
};

/**
 * Whether the page's edit lock is held by *someone other than* the current
 * session. Derived from the single source of truth ({@link lockHolderId} +
 * {@link lockHolderOwnerId}) rather than a separately-stored boolean, so it stays
 * correct no matter how the holder was set (peek, acquire, or a realtime echo).
 */
export const usePageLockedByOther = (): boolean => {
  const lockHolderId = usePageEditorStore((s) => s.lockHolderId);
  const lockHolderOwnerId = usePageEditorStore((s) => s.lockHolderOwnerId);
  const myOwnerId = usePageEditorStore((s) => s.lockOwnerId);
  const myUserId = useUserStore(userProfileSelectors.userId);

  return isLockedByOtherSession({
    holderId: lockHolderId,
    holderOwnerId: lockHolderOwnerId,
    myOwnerId,
    myUserId,
  });
};
