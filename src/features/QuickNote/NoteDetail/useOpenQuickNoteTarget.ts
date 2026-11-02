import { useCallback } from 'react';

import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { openDocumentModal } from '@/features/DocumentModal/loader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useTaskStore } from '@/store/task';

import type { QuickNoteOpenTarget } from './resolveResourceOpenTarget';

/**
 * Opens an object linked from a Quick Note in its native surface.
 *
 * Documents and Pages open in the document modal and Topics in the side drawer, so the note stays
 * in view. Tasks and Goals navigate to their detail pages.
 */
export const useOpenQuickNoteTarget = () => {
  const navigate = useWorkspaceAwareNavigate();
  const openTopicDrawer = useTaskStore((s) => s.openTopicDrawer);

  return useCallback(
    (target: QuickNoteOpenTarget, title?: string) => {
      switch (target.kind) {
        case 'document': {
          void openDocumentModal(target.documentId);
          return;
        }
        case 'topic': {
          openTopicDrawer(target.topicId, { agentId: target.agentId, title });
          return;
        }
        case 'task': {
          navigate(taskDetailPath(target.taskId, undefined, title));
          return;
        }
        case 'goal': {
          navigate(`/goal/${encodeURIComponent(target.goalId)}`);
        }
      }
    },
    [navigate, openTopicDrawer],
  );
};
