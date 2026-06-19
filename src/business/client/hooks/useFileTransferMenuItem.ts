import { type ItemType } from 'antd/es/menu/interface';

import { lambdaClient } from '@/libs/trpc/client';

import { useWorkspaceTransferItems } from './useWorkspaceTransferItems';

export const useFileTransferMenuItem = (
  id?: string,
  entityType: 'document' | 'file' | 'folder' = 'file',
): ItemType[] | null =>
  useWorkspaceTransferItems({
    copy: (targetWorkspaceId) =>
      lambdaClient.file.copyEntityToWorkspace.mutate({ entityType, id: id!, targetWorkspaceId }),
    enabled: !!id,
    move: (targetWorkspaceId) =>
      lambdaClient.file.transferEntity.mutate({ entityType, id: id!, targetWorkspaceId }),
  });
