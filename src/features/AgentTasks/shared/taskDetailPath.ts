import { taskTitleSlug } from '@lobechat/utils/taskSlug';
import { useCallback } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';

/**
 * Path to a task detail page. `title` is optional and purely cosmetic: it adds
 * the readable slug segment (`/task/T-501/ship-the-thing`) that the routes
 * accept but never resolve against, so a caller without the title in hand still
 * produces a working link.
 */
export const taskDetailPath = (taskId: string, agentId?: string, title?: string | null) => {
  const base = agentId ? `/agent/${agentId}/task/${taskId}` : `/task/${taskId}`;
  const slug = taskTitleSlug(title);

  return slug ? `${base}/${slug}` : base;
};

export const useTaskDetailPath = () => {
  const { aid } = useActiveRouteParams<{ aid?: string }>();

  return useCallback(
    (taskId: string, agentId?: string, title?: string | null) =>
      taskDetailPath(taskId, agentId ?? aid, title),
    [aid],
  );
};

export const useNavigateToTaskDetail = () => {
  const navigate = useWorkspaceAwareNavigate();
  const getTaskDetailPath = useTaskDetailPath();

  return useCallback(
    (taskId: string, agentId?: string, title?: string | null) => {
      navigate(getTaskDetailPath(taskId, agentId, title));
    },
    [getTaskDetailPath, navigate],
  );
};
