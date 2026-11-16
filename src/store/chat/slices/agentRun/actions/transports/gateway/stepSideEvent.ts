import type { StepCompleteData, SubAgentProgressData } from '@lobechat/agent-gateway-client';
import type { ConversationContext } from '@lobechat/types';

import type { ChatStore } from '@/store/chat/store';

import { insertSteerMessage } from './streamStartSeed';

/**
 * A `step_complete` that rides the event for something other than a step
 * boundary. `apply` is the store update it asks for (none when it carries
 * nothing to show); the caller enqueues it behind pending refetches.
 */
export interface StepSideEvent {
  apply?: () => void;
}

/**
 * Resolve a side-channel `step_complete`, or `undefined` for a real step
 * boundary (metrics, `execution_complete` refresh).
 *
 * - `subagent_progress`: a parked `callSubAgent` child reporting its running
 *   totals. Patched onto the placeholder tool message in memory only — the
 *   persisted values are written once, by `completeSubAgentBridge`, when the
 *   child finishes. Kept under a `progress` key so a DB refetch can never leave
 *   a stale live number where the authoritative one belongs. It must be
 *   ENQUEUED: the placeholder row only enters the store via the refetch the
 *   preceding `tools_calling` chunk queued, and `updatePluginState` against a
 *   missing row is a silent no-op — for a single-step sub-agent that lone
 *   sample is the whole live readout.
 * - `user_message`: a heterogeneous run read a queued follow-up from its live
 *   session. The server already wrote it and the queue tray drops it now, so
 *   show it at once, ahead of the reply it opens, instead of when that reply
 *   starts streaming.
 */
export const resolveStepSideEvent = (
  get: () => ChatStore,
  data: StepCompleteData | undefined,
  context: ConversationContext,
  dispatchContext: { operationId: string },
): StepSideEvent | undefined => {
  if (data?.phase === 'subagent_progress') {
    const progress = data as SubAgentProgressData;
    if (!progress.toolMessageId) return {};

    return {
      apply: () =>
        get().internal_dispatchMessage(
          {
            id: progress.toolMessageId,
            key: 'progress',
            type: 'updatePluginState',
            value: {
              model: progress.model,
              totalCost: progress.totalCost,
              totalInputTokens: progress.totalInputTokens,
              totalOutputTokens: progress.totalOutputTokens,
              totalTokens: progress.totalTokens,
              totalToolCalls: progress.totalToolCalls,
            },
          },
          dispatchContext,
        ),
    };
  }

  if (data?.phase === 'user_message') {
    const steer = data.steerMessage;
    if (!steer) return {};

    return { apply: () => insertSteerMessage(get, steer, context, dispatchContext) };
  }

  return undefined;
};
