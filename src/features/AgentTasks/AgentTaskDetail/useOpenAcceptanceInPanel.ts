import { useCallback } from 'react';

import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';

/**
 * Opens an acceptance in the panel beside the task — the destination the
 * checklist and run tags already use.
 *
 * Deliberately not a route change: the standalone `/acceptance/:id` page is a
 * public, workspace-less route, and navigating there from a workspace task
 * drops the slug from the URL so `useWorkspaceUrlSync` flips the whole app
 * back to the personal scope.
 */
export const useOpenAcceptanceInPanel = () => {
  const openAcceptance = useChatStore((state) => state.openAcceptance);
  const showTaskAgentPanel = useGlobalStore((state) => state.toggleTaskAgentPanel);

  return useCallback(
    (acceptanceId: string) => {
      showTaskAgentPanel(true);
      openAcceptance(acceptanceId);
    },
    [openAcceptance, showTaskAgentPanel],
  );
};
