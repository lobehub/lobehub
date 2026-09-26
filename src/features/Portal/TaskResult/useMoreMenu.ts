import { useTaskCopyActions } from '@/features/AgentTasks/AgentTaskDetail/useTaskCopyActions';
import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';

export const useTaskResultMoreMenu = (): PortalMoreMenuConfig | undefined => {
  // The body marks this task active while the panel is open, so the copied
  // link is byte-for-byte the one the task page's own header copies.
  const { link, taskId } = useTaskCopyActions();
  if (!taskId) return;

  return { copyId: taskId, copyLink: link };
};
