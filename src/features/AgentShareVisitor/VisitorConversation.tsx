'use client';

import type { SharedAgentData } from '@lobechat/types';
import { memo, useLayoutEffect, useState } from 'react';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

import ReadOnlyConversationArea from './ReadOnlyConversationArea';
import { useVisitorTopics } from './useVisitorTopics';
import VisitorComposer from './VisitorComposer';

/**
 * The visitor-facing conversation column: mounts the lean message surface
 * after hand-seeding the stores (popup quick-chat pattern) plus the share
 * composer wired to the gateway transport via `agentShareId`.
 */
const VisitorConversation = memo<{ data: SharedAgentData }>(({ data }) => {
  const { agentId, agentMeta, shareId } = data;
  const [seeded, setSeeded] = useState(false);
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const { mutate: refreshVisitorTopics } = useVisitorTopics(shareId);

  useLayoutEffect(() => {
    // Visitors cannot call the owner-scoped agent-config API, so seed a
    // minimal `agentMap` entry from the share metadata by hand — mere
    // presence is what flips `isAgentConfigLoading*` off for the welcome
    // header and chat input skeletons. Merged via the store's dispatcher
    // (the `/share/t` precedent) so nulls never clobber existing fields.
    useAgentStore.getState().internal_dispatchAgentMap(agentId, {
      avatar: agentMeta.avatar ?? undefined,
      backgroundColor: agentMeta.backgroundColor ?? undefined,
      name: agentMeta.name ?? undefined,
      title: agentMeta.title ?? undefined,
    });
    useAgentStore.setState({ activeAgentId: agentId }, false, 'AgentShareVisitor/seedSharedAgent');
    useChatStore.setState(
      {
        activeAgentId: agentId,
        activeGroupId: undefined,
        activeThreadId: undefined,
        activeTopicId: undefined,
      },
      false,
      'AgentShareVisitor/sync',
    );
    setSeeded(true);
  }, [agentId, agentMeta]);

  // The message surface reads the active ids on first render — mounting it before
  // the seed lands would fetch against a stale topic left by the main app.
  if (!seeded) return null;

  return (
    <>
      <ReadOnlyConversationArea agentId={agentId} agentShareId={shareId} topicId={activeTopicId} />
      <VisitorComposer
        agentId={agentId}
        blockedKey={data.budgetExhausted ? 'share.visitor.errors.insufficientBudget' : undefined}
        // The gateway transport already switched the store to the new topic
        // (`switchTopic`); refreshing the list makes it show up in the panel.
        shareId={shareId}
        topicId={activeTopicId}
        onTopicCreated={() => void refreshVisitorTopics()}
      />
    </>
  );
});

VisitorConversation.displayName = 'ShareVisitorConversation';

export default VisitorConversation;
