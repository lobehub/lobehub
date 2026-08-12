import type { WorkSummaryItem } from '@lobechat/types';
import { useCallback } from 'react';

import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { openDocumentModal } from '@/features/DocumentModal/loader';
import { getWorkTypeDescriptor, isSafeExternalUrl } from '@/features/Work/descriptors';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/**
 * Open a Work summary item at its canonical target (document modal, external
 * url, file preview or task detail). Shared by the Work gallery and the
 * resource home's recent-works section.
 */
export const useOpenWork = () => {
  const navigate = useWorkspaceAwareNavigate();

  return useCallback(
    (item: WorkSummaryItem) => {
      const openTarget = getWorkTypeDescriptor(item).getOpenTarget(item);
      if (!openTarget) return;

      switch (openTarget.kind) {
        case 'document': {
          void openDocumentModal(openTarget.documentId);
          return;
        }
        case 'external': {
          if (isSafeExternalUrl(openTarget.url))
            window.open(openTarget.url, '_blank', 'noopener,noreferrer');
          return;
        }
        case 'filePreview': {
          if (isSafeExternalUrl(openTarget.url))
            window.open(openTarget.url, '_blank', 'noopener,noreferrer');
          return;
        }
        case 'task': {
          navigate(taskDetailPath(openTarget.identifier));
        }
      }
    },
    [navigate],
  );
};
