import { useTaskCopyActions } from '@/features/AgentTasks/AgentTaskDetail/useTaskCopyActions';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';
import { useTaskStore } from '@/store/task';

export const useTaskResultMoreMenu = (): PortalMoreMenuConfig | undefined => {
  // The body marks this task active while the panel is open, so the copied
  // link is byte-for-byte the one the task page's own header copies.
  const { link, taskId } = useTaskCopyActions();
  const refreshTaskDetail = useTaskStore((s) => s.internal_refreshTaskDetail);
  if (!taskId) return;

  // The result is read off the task detail, so refreshing the task refreshes it.
  return { copyId: taskId, copyLink: link, refresh: () => refreshTaskDetail(taskId) };
};
