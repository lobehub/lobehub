import { useCallback } from 'react';

import { usePermission } from '@/hooks/usePermission';

export type TaskArchiveDeniedKey =
  'taskList.contextMenu.archiveBlocked' | 'taskList.contextMenu.archiveDenied.noEditPermission';

export interface TaskArchiveGate {
  allowed: boolean;
  /** Locale key explaining why the archive action is disabled. */
  reasonKey?: TaskArchiveDeniedKey;
}

export interface TaskArchiveGateOptions {
  /** Archiving (not restoring) a task whose run, schedule or heartbeat is still live. */
  archiveBlocked?: boolean;
}

/**
 * Archive follows the rule the server enforces: any member who can edit tasks,
 * whoever created the task, and never while work can still run. The returned
 * reason lets a disabled menu item say why instead of just greying out.
 */
export const useTaskArchiveGate = (): ((options?: TaskArchiveGateOptions) => TaskArchiveGate) => {
  const { allowed: canEditTask } = usePermission('create_content');

  return useCallback(
    (options): TaskArchiveGate => {
      if (!canEditTask)
        return { allowed: false, reasonKey: 'taskList.contextMenu.archiveDenied.noEditPermission' };
      if (options?.archiveBlocked)
        return { allowed: false, reasonKey: 'taskList.contextMenu.archiveBlocked' };
      return { allowed: true };
    },
    [canEditTask],
  );
};
