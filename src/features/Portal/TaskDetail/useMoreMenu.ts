import { confirmModal } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { openRenameModal } from '@/components/RenameModal';
import { useTaskCopyActions } from '@/features/AgentTasks/AgentTaskDetail/useTaskCopyActions';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { useTaskStore } from '@/store/task';

import { getTaskDetailPageUrl } from './url';
import { useForeignTaskDetail } from './useForeignTaskDetail';

export const useTaskDetailMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const { t } = useTranslation('chat');
  // The body marks this task active while the panel is open, so the copied
  // link is byte-for-byte the one the task page's own header copies.
  const { link, taskId } = useTaskCopyActions();
  const name = useTaskStore((s) =>
    taskId ? s.taskDetailMap[s.taskRefIndex?.[taskId] ?? taskId]?.name : undefined,
  );
  const [updateTask, deleteTask, refreshTaskDetail] = useTaskStore((s) => [
    s.updateTask,
    s.deleteTask,
    s.internal_refreshTaskDetail,
  ]);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);
  // Same gate as the task page's header menu.
  const { allowed: canEdit } = usePermission('create_content');
  const appOrigin = useAppOrigin();
  const foreign = useForeignTaskDetail();

  // A task from another workspace is shown read-only: the edit actions here
  // write through the active scope, where its identifier can name another task.
  if (foreign.workspace) {
    if (!foreign.taskId) return;
    const detail = foreign.data;

    return {
      copyId: detail?.identifier ?? foreign.taskId,
      copyLink: getTaskDetailPageUrl({
        agentId: detail?.agentId ?? undefined,
        appOrigin,
        identifier: detail?.identifier,
        title: detail?.name,
        workspaceSlug: foreign.workspace.slug,
      }),
      refresh: () => foreign.mutate(),
    };
  }

  if (!taskId) return;

  return {
    copyId: taskId,
    copyLink: link,
    delete: canEdit
      ? () =>
          confirmModal({
            content: t('taskDetail.deleteConfirm.content'),
            okButtonProps: { danger: true },
            okText: t('taskDetail.deleteConfirm.ok'),
            onOk: async () => {
              await deleteTask(taskId);
              // The task page redirects to the list; from a side panel only the
              // panel showing the now-gone task closes.
              clearPortalStack();
            },
            title: t('taskDetail.deleteConfirm.title'),
          })
      : undefined,
    refresh: () => refreshTaskDetail(taskId),
    rename: canEdit
      ? () =>
          openRenameModal({
            defaultValue: name ?? '',
            onSave: (next) => updateTask(taskId, { name: next }),
          })
      : undefined,
  };
};
