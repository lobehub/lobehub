import { type UIChatMessage } from '@lobechat/types';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  getPendingInterventions,
  type PendingIntervention,
} from '@/features/Conversation/store/slices/data/pendingInterventions';
import { type ConversationContext } from '@/features/Conversation/types';
import { useChatStore } from '@/store/chat';
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
 * Pure aggregation behind {@link useGlobalPendingApprovals}. Kept side-effect
 * free so the bucket → context resolution (the tricky part) is unit-testable
 * without a store.
 *
 * The bucket → context mapping is recovered from this client's operations,
 * whose captured `context` reproduces the exact `messageMapKey` the run used to
 * write into `dbMessagesMap`. This keeps us correct for group / thread / page
 * scopes (where the key can't be reversed from the message fields) and naturally
 * scopes the feature to runs started on this device.
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

    // Only surface runs we can resolve to a real context; without it we can't
    // mount a ConversationProvider that reads the same bucket.
    const context = contextByKey.get(key);
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
  const { dbMessagesMap, operations, activeAgentId, activeTopicId, activeThreadId } = useChatStore(
    useShallow((s) => ({
      activeAgentId: s.activeAgentId,
      activeThreadId: s.activeThreadId,
      activeTopicId: s.activeTopicId,
      dbMessagesMap: s.dbMessagesMap,
      operations: s.operations,
    })),
  );

  return useMemo(() => {
    const activeKey = activeAgentId
      ? messageMapKey({
          agentId: activeAgentId,
          threadId: activeThreadId,
          topicId: activeTopicId,
        })
      : null;

    return collectGlobalApprovals(dbMessagesMap, operations, activeKey);
  }, [dbMessagesMap, operations, activeAgentId, activeTopicId, activeThreadId]);
};
