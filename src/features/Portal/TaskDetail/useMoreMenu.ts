import { confirmModal } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { openRenameModal } from '@/components/RenameModal';
import { useTaskCopyActions } from '@/features/AgentTasks/AgentTaskDetail/useTaskCopyActions';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { useTaskStore } from '@/store/task';

export const useTaskDetailMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const { t } = useTranslation('chat');
  // The body marks this task active while the panel is open, so the copied
  // link is byte-for-byte the one the task page's own header copies.
  const { link, taskId } = useTaskCopyActions();
  const name = useTaskStore((s) => (taskId ? s.taskDetailMap[taskId]?.name : undefined));
  const [updateTask, deleteTask, refreshTaskDetail] = useTaskStore((s) => [
    s.updateTask,
    s.deleteTask,
    s.internal_refreshTaskDetail,
  ]);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);
  // Same gate as the task page's header menu.
  const { allowed: canEdit } = usePermission('create_content');

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
