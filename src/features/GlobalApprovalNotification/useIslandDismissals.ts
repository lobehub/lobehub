import { useCallback, useEffect } from 'react';

import { useGlobalStore } from '@/store/global';
import { useGoalStore } from '@/store/goal';

/**
 * Asks the user put away from the island. Dismissing only hides the island
 * card; the ask itself stays pending and keeps waiting in the Home inbox.
 *
 * The keys are kept on the server, and the island reads already leave them
 * out, so a card dismissed here also stays away on the user's other clients.
 * Keys this client stored locally before that are uploaded once.
 */
export const useIslandDismissals = (enabled: boolean) => {
  const dismissIslandItems = useGoalStore((s) => s.dismissIslandItems);
  const isStatusInit = useGlobalStore((s) => s.isStatusInit);
  const legacyKeys = useGlobalStore((s) => s.status.dismissedIslandItemKeys);
  const uploaded = useGlobalStore((s) => s.status.islandDismissalsUploaded);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  useEffect(() => {
    if (!enabled || !isStatusInit || uploaded) return;
    const keys = legacyKeys ?? [];
    const markUploaded = () => updateSystemStatus({ islandDismissalsUploaded: true });
    if (keys.length === 0) {
      markUploaded();
      return;
    }
    // Left unmarked on failure, so the next launch tries again.
    dismissIslandItems(keys).then(markUploaded, (error) =>
      console.error('[island] failed to upload local dismissals', error),
    );
  }, [dismissIslandItems, enabled, isStatusInit, legacyKeys, updateSystemStatus, uploaded]);

  // Rejects when the server did not keep it, so the caller can say so.
  return useCallback((key: string) => dismissIslandItems([key]), [dismissIslandItems]);
};
