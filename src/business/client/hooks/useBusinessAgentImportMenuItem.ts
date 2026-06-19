import { type ItemType } from 'antd/es/menu/interface';

import { lambdaClient } from '@/libs/trpc/client';

export const useBusinessAgentImportMenuItem = (agentId?: string): ItemType | null =>
  agentId
    ? {
        key: 'import-agent-to-personal',
        label: 'Импортировать в личное пространство',
        onClick: () =>
          void lambdaClient.agent.transferAgent.mutate({ agentId, targetWorkspaceId: null }),
      }
    : null;
