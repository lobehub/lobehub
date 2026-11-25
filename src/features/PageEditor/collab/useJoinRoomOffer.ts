import { useCallback } from 'react';

import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { usePageEditorStore } from '../store';
import { isRoomLockOwner } from './roomLock';
import { usePageCollabAvailable } from './usePageCollab';

// The lock holder edits in the page's room, so turning on the lab lets this member edit alongside them.
export const useJoinRoomOffer = (): (() => void) | undefined => {
  const lockHolderOwnerId = usePageEditorStore((s) => s.lockHolderOwnerId);
  const available = usePageCollabAvailable();
  const labEnabled = useUserStore(labPreferSelectors.enablePageCollab);
  const updateLab = useUserStore((s) => s.updateLab);
  const turnOn = useCallback(() => void updateLab({ enablePageCollab: true }), [updateLab]);

  return available && !labEnabled && isRoomLockOwner(lockHolderOwnerId) ? turnOn : undefined;
};
