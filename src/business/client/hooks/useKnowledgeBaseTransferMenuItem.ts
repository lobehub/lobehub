import { type ItemType } from 'antd/es/menu/interface';

import { lambdaClient } from '@/libs/trpc/client';

import { useWorkspaceTransferItems } from './useWorkspaceTransferItems';

export const useKnowledgeBaseTransferMenuItem = (id?: string): ItemType[] | null =>
  useWorkspaceTransferItems({
    copy: (targetWorkspaceId) =>
      lambdaClient.knowledgeBase.copyKnowledgeBaseToWorkspace.mutate({
        id: id!,
        targetWorkspaceId,
      }),
    enabled: !!id,
    move: (targetWorkspaceId) =>
      lambdaClient.knowledgeBase.transferKnowledgeBase.mutate({ id: id!, targetWorkspaceId }),
  });
