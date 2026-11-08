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

/** App-relative path of a task's own page, scoped to the given workspace. */
export const getTaskDetailPagePath = ({
  agentId,
  taskId,
  identifier,
  title,
  workspaceSlug,
}: Omit<TaskDetailPageUrlOptions, 'appOrigin'>): string | undefined => {
  const taskRef = identifier ?? taskId;
  if (!taskRef) return;

  return buildWorkspaceAwarePath(taskDetailPath(taskRef, agentId, title), workspaceSlug);
};

export const getTaskDetailPageUrl = ({
  appOrigin,
  ...options
}: TaskDetailPageUrlOptions): string | undefined => {
  if (!appOrigin) return;

  const path = getTaskDetailPagePath(options);
  return path && `${appOrigin}${path}`;
};
