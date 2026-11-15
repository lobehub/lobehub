import type { WorkSummaryItem } from '@lobechat/types';

import { MessageWorkList } from '@/features/Conversation/Messages/MessageWorks';
import { isSafeExternalUrl } from '@/features/Work/descriptors';

/** A channel has no Working Sidebar or chat portal: a card just opens its link. */
const openLink = (item: WorkSummaryItem) => {
  if (isSafeExternalUrl(item.url)) window.open(item.url, '_blank', 'noopener,noreferrer');
};

/** The external Works an Agent reply's run touched, as the conversation shows them. */
export const ReplyWorks = ({ works }: { works: WorkSummaryItem[] }) => (
  <MessageWorkList items={works} onOpen={openLink} />
);
