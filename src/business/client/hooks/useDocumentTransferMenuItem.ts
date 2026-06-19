import { type ItemType } from 'antd/es/menu/interface';

import { lambdaClient } from '@/libs/trpc/client';

import { useWorkspaceTransferItems } from './useWorkspaceTransferItems';

export const useDocumentTransferMenuItem = (documentId?: string): ItemType[] | null =>
  useWorkspaceTransferItems({
    copy: (targetWorkspaceId) =>
      lambdaClient.document.copyDocumentToWorkspace.mutate({
        documentId: documentId!,
        targetWorkspaceId,
      }),
    enabled: !!documentId,
    move: (targetWorkspaceId) =>
      lambdaClient.document.transferDocument.mutate({ documentId: documentId!, targetWorkspaceId }),
  });
