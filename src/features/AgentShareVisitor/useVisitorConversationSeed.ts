'use client';

import type { SharedAgentData } from '@lobechat/types';
import { useLayoutEffect, useState } from 'react';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

type SharedAgentIdentity = Pick<SharedAgentData, 'agentId' | 'agentMeta' | 'shareId'>;

const seedAgentMap = (agentId: string, agentMeta: SharedAgentIdentity['agentMeta']) => {
  // Visitors cannot call the owner-scoped agent-config API, so seed a minimal
  // `agentMap` entry from the share metadata by hand — mere presence is what
  // flips `isAgentConfigLoading*` off for the welcome header and chat input
  // skeletons. Merged via the store's dispatcher so nulls never clobber
  // existing fields.
  useAgentStore.getState().internal_dispatchAgentMap(agentId, {
    avatar: agentMeta.avatar ?? undefined,
    backgroundColor: agentMeta.backgroundColor ?? undefined,
    name: agentMeta.name ?? undefined,
    title: agentMeta.title ?? undefined,
  });
};

/**
 * Seeds the agent/chat stores for the visitor-facing share surface and reports
 * whether the one-time destructive init has landed yet.
 *
 * Split into two effects with different dependencies on purpose:
 * - **identity effect** (`agentId`/`shareId`): the one destructive init —
 *   resets chat-store selection state (`activeTopicId` and friends). Must
 *   only fire when the agent/share identity actually changes.
 * - **metadata effect** (`agentMeta`): non-destructive agentMap re-seed so
 *   the header avatar/name/title stay fresh. An SWR revalidation hands back a
 *   brand-new `agentMeta` object even when the identity hasn't changed;
 *   folding this into the identity effect would wipe `activeTopicId` on every
 *   metadata refresh and yank the visitor into a new conversation mid-chat.
 */
export const useVisitorConversationSeed = ({
  agentId,
  agentMeta,
  shareId,
}: SharedAgentIdentity): boolean => {
  const [seeded, setSeeded] = useState(false);

  useLayoutEffect(() => {
    seedAgentMap(agentId, agentMeta);
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
    // Deliberately keyed on the agent/share identity only — the metadata
    // effect below handles `agentMeta` changes without touching chat-store
    // selection state. See the doc comment above for why.
  }, [agentId, shareId]);

  useLayoutEffect(() => {
    seedAgentMap(agentId, agentMeta);
  }, [agentId, agentMeta]);

  return seeded;
};
