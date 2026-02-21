import { type MouseEventHandler } from 'react';
import { useCallback } from 'react';

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
  const toggleMessageEditing = useConversationStore((s) => s.toggleMessageEditing);

  return useCallback<MouseEventHandler<HTMLDivElement>>(
    (e) => {
      if (
        disableEditing ||
        error ||
        id === 'default' ||
        !e.altKey ||
        !['assistant', 'user'].includes(role)
      )
        return;

      toggleMessageEditing(id, true);
    },
    [role, disableEditing, toggleMessageEditing, id],
  );
};
