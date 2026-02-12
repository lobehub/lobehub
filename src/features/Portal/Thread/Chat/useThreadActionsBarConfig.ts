'use client';

import { useMemo } from 'react';

import { type ActionsBarConfig } from '@/features/Conversation';

/**
 * Hook to create thread-specific actionsBar configuration
 *
 * In thread mode:
 * - Parent messages (before thread divider) should be read-only (handled via disableEditing prop)
 * - Thread messages can be edited/deleted normally
 *
 * Note: Parent message disabling is now handled directly in the itemContent renderer
 * via the disableEditing prop, rather than through actionsBar config.
 */
export const useThreadActionsBarConfig = (): ActionsBarConfig => {
  // For thread mode, we return a minimal config
  // Parent message editing is handled via disableEditing prop in itemContent
  return useMemo(
    () => ({
      // Thread-specific actions can be added here if needed
      assistant: {},
      user: {},
    }),
    [],
  );
};
