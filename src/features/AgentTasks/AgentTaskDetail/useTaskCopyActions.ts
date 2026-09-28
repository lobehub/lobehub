import { copyToClipboard } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { taskDetailPath } from '../shared/taskDetailPath';

/**
 * Clipboard actions for the active task. Shared by the header's quick buttons
 * and its overflow menu so both copy byte-for-byte the same link.
 */
export const useTaskCopyActions = () => {
  const { t } = useTranslation('chat');

  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const taskAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const taskTitle = useTaskStore(taskDetailSelectors.activeTaskName);

  const copyId = useCallback(async () => {
    if (!taskId) return;

    await copyToClipboard(taskId);
    toast.success(t('taskList.contextMenu.copyIdSuccess'));
  }, [taskId, t]);

  // Carry the title into the link so a pasted URL says what the task is.
  const link = useMemo(
    () =>
      taskId
        ? `${appOrigin}${buildWorkspaceAwarePath(
            taskDetailPath(taskId, taskAgentId ?? undefined, taskTitle),
            activeWorkspaceSlug,
          )}`
        : undefined,
    [taskId, taskAgentId, taskTitle, appOrigin, activeWorkspaceSlug],
  );

  const copyLink = useCallback(async () => {
    if (!link) return;

    await copyToClipboard(link);
    toast.success(t('taskList.contextMenu.copyLinkSuccess'));
  }, [link, t]);

  return { copyId, copyLink, link, taskId };
};
