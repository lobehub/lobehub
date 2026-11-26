import type { UIChatMessage } from '@lobechat/types';

import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import type { ChatStore } from '@/store/chat/store';

/**
 * Claim the right to apply a main-agent `tool_state` snapshot. A snapshot is
 * applied only when its sequence beats both the one stored on the tool row for
 * this operation and the last one this run applied.
 *
 * @returns The metadata to stamp with the applied snapshot, or `undefined` for
 *   a stale snapshot that must be dropped.
 */
export const createToolStateSnapshotClaimer = (get: () => ChatStore, operationId: string) => {
  const lastAppliedSeqByCallId = new Map<string, number>();

  return (
    toolCallId: string,
    toolMsgId: string,
    snapshotSeq: number,
  ): NonNullable<UIChatMessage['metadata']> | undefined => {
    const stored = dbMessageSelectors.getDbMessageById(toolMsgId)(get());
    const durableSeq =
      stored?.metadata?.heterogeneousToolStateOperationId === operationId &&
      typeof stored.metadata.heterogeneousToolStateSeq === 'number'
        ? stored.metadata.heterogeneousToolStateSeq
        : 0;
    const lastApplied = Math.max(durableSeq, lastAppliedSeqByCallId.get(toolCallId) ?? 0);
    if (snapshotSeq <= lastApplied) return;

    lastAppliedSeqByCallId.set(toolCallId, snapshotSeq);
    return {
      heterogeneousToolStateOperationId: operationId,
      heterogeneousToolStateSeq: snapshotSeq,
    };
  };
};
