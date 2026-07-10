import { type MouseEventHandler } from 'react';
import { useCallback } from 'react';

import { usePermission } from '@/hooks/usePermission';

import { useConversationStore } from '../store';

interface UseDoubleClickEditProps {
  disableEditing?: boolean;
  error: any;
  id: string;
  role: string;
}

export const useDoubleClickEdit = ({
  disableEditing,
  role,
  error,
  id,
}: UseDoubleClickEditProps) => {
  const { allowed: canEdit } = usePermission('edit_own_content');
  const toggleMessageEditing = useConversationStore((s) => s.toggleMessageEditing);

  return useCallback<MouseEventHandler<HTMLDivElement>>(
    (e) => {
      if (
        !canEdit ||
        disableEditing ||
        error ||
        id === 'default' ||
        !e.altKey ||
        !['assistant', 'user'].includes(role)
      )
        return;

      toggleMessageEditing(id, true);
    },
    [role, canEdit, disableEditing, error, toggleMessageEditing, id],
  );
};
