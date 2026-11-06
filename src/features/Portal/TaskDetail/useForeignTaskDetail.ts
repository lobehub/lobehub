import type { TaskDetailData } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { taskService } from '@/services/task';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import {
  hasInFlightActivity,
  TASK_DETAIL_POLL_INTERVAL,
} from '@/store/task/slices/detail/inFlight';
import { isTrpcErrorCode } from '@/utils/trpcError';

export const FOREIGN_TASK_NOT_FOUND = 'TASK_NOT_FOUND';

export const foreignTaskDetailKey = (workspaceId: string, taskId: string) =>
  ['portal-foreign-task-detail', workspaceId, taskId] as const;

const taskNotFound = () =>
  Object.assign(new Error('Task not found'), { code: FOREIGN_TASK_NOT_FOUND });

const fetchForeignTaskDetail = async (
  taskId: string,
  workspaceId: string,
): Promise<TaskDetailData> => {
  const result = await taskService.getDetailInWorkspace(taskId, workspaceId).catch((error) => {
    throw isTrpcErrorCode(error, 'NOT_FOUND') ? taskNotFound() : error;
  });
  if (!result.data?.id) throw taskNotFound();
  return result.data;
};

/**
 * The task shown in the portal when it lives in another workspace. Header,
 * title and body share one SWR key, so they read a single request.
 */
export const useForeignTaskDetail = () => {
  const taskId = useChatStore(chatPortalSelectors.taskDetailId);
  const workspace = useChatStore(chatPortalSelectors.taskDetailWorkspace);

  const swr = useClientDataSWR(
    taskId && workspace ? foreignTaskDetailKey(workspace.id, taskId) : null,
    () => fetchForeignTaskDetail(taskId!, workspace!.id),
    {
      // Same rule as the active-scope detail: follow a run until it settles.
      refreshInterval: (data?: TaskDetailData) =>
        hasInFlightActivity(data) ? TASK_DETAIL_POLL_INTERVAL : 0,
      revalidateOnFocus: false,
    },
  );

  return { ...swr, taskId, workspace };
};
