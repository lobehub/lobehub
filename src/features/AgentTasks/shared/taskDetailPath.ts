import { useCallback } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useParams } from '@/libs/router/navigation';

export const taskDetailPath = (taskId: string, agentId?: string) =>
  agentId ? `/agent/${agentId}/task/${taskId}` : `/task/${taskId}`;

export const useTaskDetailPath = () => {
  const { aid } = useParams<{ aid?: string }>('aid');

  return useCallback(
    (taskId: string, agentId?: string) => taskDetailPath(taskId, agentId ?? aid),
    [aid],
  );
};

export const useNavigateToTaskDetail = () => {
  const navigate = useWorkspaceAwareNavigate();
  const getTaskDetailPath = useTaskDetailPath();

  return useCallback(
    (taskId: string, agentId?: string) => {
      navigate(getTaskDetailPath(taskId, agentId));
    },
    [getTaskDetailPath, navigate],
  );
};
