import type { WorkSummaryItem } from '@lobechat/types';

import { openCollectionModal } from '@/features/CollectionModal/loader';
import { MessageWorkList } from '@/features/Conversation/Messages/MessageWorks';
import { getWorkTypeDescriptor, isSafeExternalUrl } from '@/features/Work/descriptors';
import { useAppOrigin } from '@/hooks/useAppOrigin';

/**
 * A channel has no Working Sidebar or chat portal, and a shared Agent's visitor cannot read the
 * owner's Work: a link opens in a new tab, a file from its URL (`/f/:id` is public by id), and a
 * collection in the image modal from the images its summary row carries. The server sends no other
 * Work type to a Channel (`replyWorksByMessage`).
 */
export const openReplyWork = (item: WorkSummaryItem, appOrigin: string) => {
  const target = getWorkTypeDescriptor(item).getOpenTarget(item);
  switch (target?.kind) {
    case 'external': {
      if (isSafeExternalUrl(target.url)) window.open(target.url, '_blank', 'noopener,noreferrer');
      return;
    }
    case 'filePreview': {
      const url = isSafeExternalUrl(target.url)
        ? target.url
        : `${appOrigin}/f/${encodeURIComponent(target.fileId)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    case 'collection': {
      if (target.items) void openCollectionModal({ items: target.items, title: target.title });
      return;
    }
    default: {
      return;
    }
  }
};

/** The Works an Agent reply's run touched, as the conversation shows them. */
export const ReplyWorks = ({ works }: { works: WorkSummaryItem[] }) => {
  const appOrigin = useAppOrigin();
  return <MessageWorkList items={works} onOpen={(item) => openReplyWork(item, appOrigin)} />;
};
