'use client';

import { useMemo } from 'react';

import { type ActionsBarConfig, type MessageActionsConfig } from '@/features/Conversation';

interface UseThreadActionsBarConfigOptions {
  /**
   * When true, every role's bar+menu is wiped so the thread renders as a
   * read-only record. Used for subagent Threads whose contents are owned
   * by the external CLI — edit / regenerate / delete would mutate state
   * the user can't meaningfully re-drive.
   */
  readonly?: boolean;
}

// Empty arrays (not `undefined`) so the underlying `actionsConfig?.bar ?? DEFAULT_BAR`
// fallback doesn't fill them back in with the default set.
const EMPTY_MESSAGE_ACTIONS: MessageActionsConfig = { bar: [], menu: [] };

/**
 * Hook to create thread-specific actionsBar configuration
 *
 * In thread mode:
 * - Parent messages (before thread divider) should be read-only (handled via disableEditing prop)
 * - Thread messages can be edited/deleted normally
 * - Subagent threads (`readonly: true`) hide the whole action bar across roles
 *
 * Note: Parent message disabling is now handled directly in the itemContent renderer
 * via the disableEditing prop, rather than through actionsBar config.
 */
export const useThreadActionsBarConfig = ({
  readonly = false,
}: UseThreadActionsBarConfigOptions = {}): ActionsBarConfig => {
  return useMemo(
    () =>
      readonly
        ? {
            assistant: EMPTY_MESSAGE_ACTIONS,
            assistantGroup: EMPTY_MESSAGE_ACTIONS,
            user: EMPTY_MESSAGE_ACTIONS,
          }
        : {
            // Thread-specific actions can be added here if needed
            assistant: {},
            user: {},
          },
    [readonly],
  );
};
