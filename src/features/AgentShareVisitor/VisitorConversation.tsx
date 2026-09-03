'use client';

import type { SharedAgentData } from '@lobechat/types';
import { memo } from 'react';

import { useGatewayReconnect } from '@/hooks/useGatewayReconnect';
import { useChatStore } from '@/store/chat';

import ReadOnlyConversationArea from './ReadOnlyConversationArea';
import { resolveVisitorRunningOperation } from './resolveVisitorRunningOperation';
import { isShareInteractive } from './shareInteractivity';
import { useVisitorConversationSeed } from './useVisitorConversationSeed';
import { useVisitorTopics } from './useVisitorTopics';
import VisitorComposer from './VisitorComposer';

/**
 * The visitor-facing conversation column: mounts the lean message surface
 * after hand-seeding the stores, plus the share composer wired to the gateway
 * transport via `agentShareId`.
 */
const VisitorConversation = memo<{ data: SharedAgentData }>(({ data }) => {
  const { agentId, shareId } = data;
  const seeded = useVisitorConversationSeed(data);
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const interactive = isShareInteractive(data.visibility);
  const { data: topics, mutate: refreshVisitorTopics } = useVisitorTopics(shareId, interactive);

  // Reconnects a still-running Gateway stream after a page reload. A
  // non-interactive share (owner preview) never has a live run and its
  // `getTopics` fetch is skipped (see `useVisitorTopics`), so both args are
  // withheld rather than resolved against stale/empty data.
  useGatewayReconnect(
    interactive ? activeTopicId : undefined,
    interactive ? resolveVisitorRunningOperation(topics, activeTopicId) : undefined,
    agentId,
    shareId,
  );

  // The message surface reads the active ids on first render — mounting it
  // before the seed lands would fetch against a stale topic left by the main app.
  if (!seeded) return null;

  return (
    <>
      <ReadOnlyConversationArea agentId={agentId} agentShareId={shareId} topicId={activeTopicId} />
      <VisitorComposer
        agentId={agentId}
        // An owner previewing their own private share can view it but not chat.
        blockedKey={interactive ? undefined : 'share.visitor.errors.sharingPaused'}
        shareId={shareId}
        // The gateway transport already switched the store to the new topic
        // (`switchTopic`); refreshing the list makes it show up in the panel.
        topicId={activeTopicId}
        onTopicCreated={() => void refreshVisitorTopics()}
      />
    </>
  );
});

VisitorConversation.displayName = 'ShareVisitorConversation';

export default VisitorConversation;
