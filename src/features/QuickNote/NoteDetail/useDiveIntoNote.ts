import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useQuickNoteStore } from '@/store/quickNote';

/**
 * Starts a Dive for one note and opens the Task it created.
 *
 * Use when:
 * - The user clicks Dive; the click itself confirms creating and running the Task.
 *
 * Returns:
 * - A handler that resolves after navigation, or after a failure toast.
 */
export const useDiveIntoNote = (noteId: string) => {
  const { t } = useTranslation('note');
  const navigate = useWorkspaceAwareNavigate();
  const diveInto = useQuickNoteStore((s) => s.diveInto);

  return useCallback(async () => {
    try {
      const taskId = await diveInto(noteId);
      if (taskId) navigate(taskDetailPath(taskId));
    } catch {
      toast.error(t('dive.failed'));
    }
  }, [diveInto, navigate, noteId, t]);
};
