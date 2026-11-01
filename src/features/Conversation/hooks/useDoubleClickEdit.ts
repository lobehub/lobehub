import { type MouseEventHandler } from 'react';
import { useCallback } from 'react';

import { useCanEditCodexMessage } from '@/hooks/useCanEditCodexMessage';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useConversationStore } from '../store';

interface UseDoubleClickEditProps {
  disableEditing?: boolean;
  error: any;
  id: string;
  role: string;
}

/**
 * Opens the message editor through the Alt-double-click shortcut.
 *
 * Use when:
 * - Attaching the existing edit shortcut to a conversation message.
 *
 * Expects:
 * - The owning conversation provider and current content permissions.
 *
 * Returns:
 * - A handler that opens supported edits and ignores unavailable user edits.
 */
export const useDoubleClickEdit = ({
  disableEditing,
  role,
  error,
  id,
}: UseDoubleClickEditProps) => {
  const { allowed: canEdit } = usePermission('edit_own_content');
  const toggleMessageEditing = useConversationStore((s) => s.toggleMessageEditing);
  const [agentId, topicId] = useConversationStore((s) => [s.context.agentId, s.context.topicId]);
  const canEditCodex = useCanEditCodexMessage(agentId ?? undefined, topicId);
  const isCodex = useAgentStore((s) =>
    agentId
      ? agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider?.type === 'codex'
      : false,
  );

  return useCallback<MouseEventHandler<HTMLDivElement>>(
    (e) => {
      if (
        !canEdit ||
        (role === 'user' && isCodex && !canEditCodex) ||
        disableEditing ||
        error ||
        id === 'default' ||
        !e.altKey ||
        !['assistant', 'user'].includes(role)
      )
        return;

      toggleMessageEditing(id, true);
    },
    [role, canEdit, canEditCodex, isCodex, disableEditing, error, toggleMessageEditing, id],
  );
};
