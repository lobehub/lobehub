import type { ChannelPublicWork, ExternalWorkSummaryItem, WorkSummaryItem } from '@lobechat/types';
import { useMemo } from 'react';

import { MessageWorkList } from '@/features/Conversation/Messages/MessageWorks';
import { isSafeExternalUrl } from '@/features/Work/descriptors';

const EPOCH = new Date(0);

/**
 * The summary card's input, from the public projection. The server leaves out every id, so the
 * URL stands in as the card's key; fields the card does not draw stay empty.
 */
export const channelWorkSummary = (work: ChannelPublicWork): ExternalWorkSummaryItem => ({
  createdAt: EPOCH,
  currentVersionId: null,
  description: work.description,
  event: {
    changeType: 'updated',
    createdAt: EPOCH,
    cumulativeCost: work.totalCost,
    cumulativeUsage: work.totalTokens
      ? { capturedAt: '', usage: { llm: { tokens: { total: work.totalTokens } } } }
      : null,
    id: work.url,
    messageId: null,
    metadata: work.headBranch
      ? { baseBranch: work.baseBranch ?? undefined, headBranch: work.headBranch }
      : null,
    rootOperationId: null,
    toolCallId: null,
    toolName: '',
    version: 1,
  },
  id: work.url,
  identifier: work.identifier,
  originAgentId: null,
  originThreadId: null,
  originTopicId: null,
  resourceDeleted: false,
  resourceId: null,
  resourceType: work.resourceType,
  status: work.status,
  title: work.title,
  toolIdentifier: '',
  toolName: '',
  totalCost: work.totalCost,
  type: 'external',
  updatedAt: EPOCH,
  url: work.url,
  userId: '',
  version: null,
  visibility: 'private',
  workspaceId: null,
});

/** A channel has no Working Sidebar or chat portal: a card just opens its link. */
const openLink = (item: WorkSummaryItem) => {
  if (isSafeExternalUrl(item.url)) window.open(item.url, '_blank', 'noopener,noreferrer');
};

/** The external Works an Agent reply's run touched, as the conversation shows them. */
export const ReplyWorks = ({ works }: { works: ChannelPublicWork[] }) => {
  const items = useMemo(() => works.map(channelWorkSummary), [works]);
  return <MessageWorkList items={items} onOpen={openLink} />;
};
