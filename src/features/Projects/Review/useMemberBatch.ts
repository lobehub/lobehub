import type { ProjectMemberRole } from '@lobechat/types';
import { useState } from 'react';

/**
 * The people picked in the add-member dialog and the save of that batch. The selection locks
 * while saving: `submit` has already sent it, so a later change would be dropped on close.
 */
export const useMemberBatch = (
  onAdd: (userIds: string[], role: ProjectMemberRole) => Promise<void>,
  onDone: () => void,
) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [role, setRole] = useState<ProjectMemberRole>('member');
  const [adding, setAdding] = useState(false);

  const toggle = (userId: string) => {
    if (adding) return;
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };

  const submit = async () => {
    setAdding(true);
    try {
      await onAdd(selected, role);
      onDone();
    } catch {
      // `onAdd` already told the user; keep the selection so they can retry.
    } finally {
      setAdding(false);
    }
  };

  return { adding, role, selected, setRole, submit, toggle };
};
