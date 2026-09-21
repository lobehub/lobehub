import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

interface TaskDetailPageUrlOptions {
  agentId?: string;
  appOrigin?: string;
  taskId?: string;
  /** Optional readable slug source; omitting it still yields a working link. */
  title?: string | null;
  workspaceSlug?: string | null;
}

export const getTaskDetailPageUrl = ({
  agentId,
  appOrigin,
  taskId,
  title,
  workspaceSlug,
}: TaskDetailPageUrlOptions): string | undefined => {
  if (!appOrigin || !taskId) return;

  const path = buildWorkspaceAwarePath(taskDetailPath(taskId, agentId, title), workspaceSlug);
  return `${appOrigin}${path}`;
};
