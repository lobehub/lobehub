import { type PortalMoreMenuConfig } from '@/features/Portal/components/PortalMoreMenu/types';

import { usePortalDocumentTitleState } from './titleContext';
import { usePortalDocumentHeaderActions } from './usePortalDocumentHeader';

export const useDocumentMoreMenu = (): PortalMoreMenuConfig | undefined => {
  const { isLoading, metaLocked, startEdit } = usePortalDocumentTitleState();
  const { documentId, refresh, url } = usePortalDocumentHeaderActions();

  if (!documentId || isLoading) return;

  return {
    copyId: documentId,
    copyLink: url,
    refresh,
    rename: metaLocked ? undefined : startEdit,
  };
};
