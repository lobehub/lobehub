import type { MessagePatchData } from '@lobechat/agent-gateway-client';
import type { UIChatMessage } from '@lobechat/types';

/**
 * Apply one canonical protocol-v2 patch to the raw conversation list.
 * Returns undefined when an insertion anchor is missing; callers then perform
 * the existing full DB reconciliation instead of guessing an order.
 */
export const applyMessagePatch = (
  messages: UIChatMessage[],
  patch: MessagePatchData,
): UIChatMessage[] | undefined => {
  const removed = new Set(patch.deletes);
  const next = messages.filter((message) => !removed.has(message.id));

  for (const { afterId, message } of patch.upserts) {
    const existingIndex = next.findIndex((item) => item.id === message.id);
    if (existingIndex >= 0) {
      next[existingIndex] = message;
      continue;
    }

    if (afterId === null) {
      next.unshift(message);
      continue;
    }

    const anchorIndex = next.findIndex((item) => item.id === afterId);
    if (anchorIndex < 0) return undefined;
    next.splice(anchorIndex + 1, 0, message);
  }

  return next;
};
