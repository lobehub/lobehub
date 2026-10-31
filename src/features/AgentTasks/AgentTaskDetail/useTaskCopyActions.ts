import { copyToClipboard, toast } from '@lobehub/ui';
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
  const identifier = useTaskStore((s) =>
    taskId ? s.taskDetailMap[s.taskRefIndex?.[taskId] ?? taskId]?.identifier : undefined,
  );
  const taskTitle = useTaskStore(taskDetailSelectors.activeTaskName);
  const instruction = useTaskStore(taskDetailSelectors.activeTaskInstruction);

  const copyId = useCallback(async () => {
    if (!identifier) return;

    await copyToClipboard(identifier);
    toast.success(t('taskList.contextMenu.copyIdSuccess'));
  }, [identifier, t]);

  // Carry the title into the link so a pasted URL says what the task is.
  const link = useMemo(
    () =>
      identifier
        ? `${appOrigin}${buildWorkspaceAwarePath(
            taskDetailPath(identifier, taskAgentId ?? undefined, taskTitle),
            activeWorkspaceSlug,
          )}`
        : undefined,
    [identifier, taskAgentId, taskTitle, appOrigin, activeWorkspaceSlug],
  );

  const copyLink = useCallback(async () => {
    if (!link) return;

    await copyToClipboard(link);
    toast.success(t('taskList.contextMenu.copyLinkSuccess'));
  }, [link, t]);

  // The instruction is stored as markdown, so the copy pastes cleanly into
  // other agents, issues or chats.
  const content = instruction?.trim() ? instruction : undefined;

  const copyContent = useCallback(async () => {
    if (!content) return;

    await copyToClipboard(content);
    toast.success(t('taskList.contextMenu.copyContentSuccess'));
  }, [content, t]);

  return { copyContent, copyId, copyLink, hasContent: !!content, link, taskId };
};
