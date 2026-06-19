import { type ItemType } from 'antd/es/menu/interface';

import { lambdaClient } from '@/libs/trpc/client';

import { useWorkspaceTransferItems } from './useWorkspaceTransferItems';

export const useAgentTransferMenuItem = (agentId?: string): ItemType[] | null =>
  useWorkspaceTransferItems({
    enabled: !!agentId,
    move: (targetWorkspaceId) =>
      lambdaClient.agent.transferAgent.mutate({ agentId: agentId!, targetWorkspaceId }),
  });
