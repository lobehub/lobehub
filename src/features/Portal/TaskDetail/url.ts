import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

interface TaskDetailPageUrlOptions {
  agentId?: string;
  appOrigin?: string;
  taskId?: string;
  workspaceSlug?: string | null;
}

export const getTaskDetailPageUrl = ({
  agentId,
  appOrigin,
  taskId,
  workspaceSlug,
}: TaskDetailPageUrlOptions): string | undefined => {
  if (!appOrigin || !taskId) return;

  const path = buildWorkspaceAwarePath(taskDetailPath(taskId, agentId), workspaceSlug);
  return `${appOrigin}${path}`;
};
