import { type ItemType } from 'antd/es/menu/interface';

import { lambdaClient } from '@/libs/trpc/client';

import { useWorkspaceTransferItems } from './useWorkspaceTransferItems';

export const useTaskTransferMenuItem = (taskId?: string): ItemType[] | null =>
  useWorkspaceTransferItems({
    copy: (targetWorkspaceId) =>
      lambdaClient.task.copyTaskToWorkspace.mutate({ targetWorkspaceId, taskId: taskId! }),
    enabled: !!taskId,
    move: (targetWorkspaceId) =>
      lambdaClient.task.transferTask.mutate({ targetWorkspaceId, taskId: taskId! }),
  });
