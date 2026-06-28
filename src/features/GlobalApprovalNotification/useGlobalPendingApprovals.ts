import { type UIChatMessage } from '@lobechat/types';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  getPendingInterventions,
  type PendingIntervention,
} from '@/features/Conversation/store/slices/data/pendingInterventions';
import { type ConversationContext } from '@/features/Conversation/types';
import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';
import { type Operation } from '@/store/chat/slices/operation/types';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

/**
 * One conversation's worth of pending approvals, ready to be surfaced in the
 * global notification. Grouped per context so a single card can mount one
 * `ConversationProvider` and tab between multiple pending tools.
 */
export interface GlobalApprovalGroup {
  /** Authoritative context resolved from the run that owns the bucket. */
  context: ConversationContext;
  interventions: PendingIntervention[];
  /** `messageMapKey(context)` — stable identity for animation keys. */
  key: string;
}

/**
 * Best-effort context recovery from a bucket's own messages, used when no live
 * operation pins the bucket (a parked run's `execAgentRuntime` op completes once
 * it hits `waiting_for_human` and is GC'd ~30s later, while the tool message
 * stays `pending`). We only trust a reconstruction that reproduces the exact
 * bucket key, so group/page scopes — whose key can't be rebuilt from message
 * fields — are skipped rather than mounted against the wrong bucket.
 */
const reconstructContextFromMessages = (
  messages: UIChatMessage[],
  key: string,
): ConversationContext | undefined => {
  const m = messages.find((msg) => msg.agentId && msg.agentId !== 'supervisor');
  if (!m?.agentId) return undefined;

  const context: ConversationContext = {
    agentId: m.agentId,
    threadId: m.threadId ?? undefined,
    topicId: m.topicId ?? undefined,
  };
  return messageMapKey(context) === key ? context : undefined;
};

/**
 * Pure aggregation behind {@link useGlobalPendingApprovals}. Kept side-effect
 * free so the bucket → context resolution (the tricky part) is unit-testable
 * without a store.
 *
 * The bucket → context mapping is recovered first from this client's operations
 * (whose captured `context` reproduces the exact `messageMapKey` the run used,
 * staying correct for group / thread / page scopes), then falls back to the
 * bucket's own messages so a parked approval stays visible after its operation
 * is garbage-collected.
 */
export const collectGlobalApprovals = (
  dbMessagesMap: Record<string, UIChatMessage[]>,
  operations: Record<string, Operation>,
  activeKey: string | null,
): GlobalApprovalGroup[] => {
  // Build the authoritative bucketKey → context map from in-flight runs.
  const contextByKey = new Map<string, ConversationContext>();
  for (const op of Object.values(operations)) {
    const ctx = op.context;
    if (!ctx?.agentId) continue;
    const key = messageMapKey(ctx as ConversationContext);
    if (!contextByKey.has(key)) contextByKey.set(key, ctx as ConversationContext);
  }

  const groups: GlobalApprovalGroup[] = [];
  for (const [key, messages] of Object.entries(dbMessagesMap)) {
    // Skip the conversation already on screen — InterventionBar owns it.
    if (key === activeKey) continue;
    if (!messages?.length) continue;

    const interventions = getPendingInterventions(messages);
    if (interventions.length === 0) continue;

    // Resolve a context we can mount a ConversationProvider against (operation
    // first, then message-field fallback). Without it we can't read the bucket.
    const context = contextByKey.get(key) ?? reconstructContextFromMessages(messages, key);
    if (!context) continue;

    groups.push({ context, interventions, key });
  }

  return groups;
};

/**
 * Aggregate pending human-approval requests across **all locally-driven runs**,
 * excluding the conversation the user is currently viewing (the in-place
 * `InterventionBar` already handles that one).
 */
export const useGlobalPendingApprovals = (): GlobalApprovalGroup[] => {
  const { dbMessagesMap, operations } = useChatStore(
    useShallow((s) => ({
      dbMessagesMap: s.dbMessagesMap,
      operations: s.operations,
    })),
  );
  // Active conversation's bucket key — built from the full scoped context
  // (agent / topic / thread / group) so a pending approval in the on-screen
  // group/thread conversation is excluded, not duplicated.
  const activeKey = useChatStore(displayMessageSelectors.currentDisplayChatKey);

  return useMemo(
    () => collectGlobalApprovals(dbMessagesMap, operations, activeKey),
    [dbMessagesMap, operations, activeKey],
  );
};
