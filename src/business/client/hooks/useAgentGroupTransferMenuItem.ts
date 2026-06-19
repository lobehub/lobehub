import type { ItemType } from 'antd/es/menu/interface';

import { lambdaClient } from '@/libs/trpc/client';

import { useWorkspaceTransferItems } from './useWorkspaceTransferItems';

export const useAgentGroupTransferMenuItem = (groupId?: string): ItemType[] | null =>
  useWorkspaceTransferItems({
    enabled: !!groupId,
    move: (targetWorkspaceId) =>
      lambdaClient.group.transferGroup.mutate({ groupId: groupId!, targetWorkspaceId }),
  });
