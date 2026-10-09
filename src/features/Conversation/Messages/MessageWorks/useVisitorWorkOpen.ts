import type { WorkSummaryItem } from '@lobechat/types';
import { useCallback } from 'react';

import { getWorkTypeDescriptor, isSafeExternalUrl } from '@/features/Work/descriptors';
import { createShareVisitorDocumentModal } from '@/features/Work/ShareVisitorDocumentModal';
import { useChatStore } from '@/store/chat';

import { useConversationStore } from '../../store';

/**
 * Open handler for Work cards on the agent-share visitor surface. The card's
 * default open targets (Portal document viewer, owner file fetch, task detail)
 * are all owner-scoped, so opens route through share-authorized paths instead.
 * `/f/:id` is public by id, so a file previews in the visitor page's portal
 * straight from its URL.
 */
export const useVisitorWorkOpen = () => {
  const agentShareId = useConversationStore((s) => s.context.agentShareId);
  const topicId = useConversationStore((s) => s.context.topicId);
  const openFilePreview = useChatStore((s) => s.openFilePreview);

  return useCallback(
    (item: WorkSummaryItem) => {
      if (!agentShareId || !topicId) return;
      const descriptor = getWorkTypeDescriptor(item);
      const target = descriptor.getOpenTarget(item);
      if (!target) return;

      switch (target.kind) {
        case 'document': {
          createShareVisitorDocumentModal({
            documentId: target.documentId,
            shareId: agentShareId,
            title: descriptor.getTitle(item)?.trim() || descriptor.getIdentifier(item) || item.id,
            topicId,
          });
          return;
        }
        case 'filePreview': {
          if (!isSafeExternalUrl(target.url)) return;
          openFilePreview({
            fileId: target.fileId,
            source: { name: descriptor.getTitle(item) || target.fileId, url: target.url },
          });
          return;
        }
        case 'external': {
          if (isSafeExternalUrl(target.url))
            window.open(target.url, '_blank', 'noopener,noreferrer');
          return;
        }
        default: {
          return;
        }
      }
    },
    [agentShareId, openFilePreview, topicId],
  );
};
