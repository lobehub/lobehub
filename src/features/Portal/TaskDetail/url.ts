import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

interface TaskDetailPageUrlOptions {
  agentId?: string;
  appOrigin?: string;
  identifier?: string;
  taskId?: string;
  /** Optional readable slug source; omitting it still yields a working link. */
  title?: string | null;
  workspaceSlug?: string | null;
}

export const getTaskDetailPageUrl = ({
  agentId,
  appOrigin,
  taskId,
  identifier,
  title,
  workspaceSlug,
}: TaskDetailPageUrlOptions): string | undefined => {
  const taskRef = identifier ?? taskId;
  if (!appOrigin || !taskRef) return;

  const path = buildWorkspaceAwarePath(taskDetailPath(taskRef, agentId, title), workspaceSlug);
  return `${appOrigin}${path}`;
};
