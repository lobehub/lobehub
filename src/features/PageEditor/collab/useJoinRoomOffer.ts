import { useCallback } from 'react';

import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { usePageEditorStore } from '../store';
import { isRoomLockOwner } from './roomLock';
import { usePageCollabAvailable } from './usePageCollab';

export interface JoinRoomOffer {
  // Preferences don't sync across tabs, so the user's other tab keeps its stored-page lock until it reloads.
  reloadOtherTab: boolean;
  turnOn: () => void;
}

// Room members never lock each other, so turning on the lab ends the lock whenever the holder is, or can be, in the room.
export const useJoinRoomOffer = (lockedBySelf: boolean): JoinRoomOffer | undefined => {
  const lockHolderOwnerId = usePageEditorStore((s) => s.lockHolderOwnerId);
  const available = usePageCollabAvailable();
  const labEnabled = useUserStore(labPreferSelectors.enablePageCollab);
  const updateLab = useUserStore((s) => s.updateLab);
  const turnOn = useCallback(() => void updateLab({ enablePageCollab: true }), [updateLab]);

  if (!available || labEnabled) return undefined;
  if (isRoomLockOwner(lockHolderOwnerId)) return { reloadOtherTab: false, turnOn };
  if (lockedBySelf) return { reloadOtherTab: true, turnOn };
  return undefined;
};
