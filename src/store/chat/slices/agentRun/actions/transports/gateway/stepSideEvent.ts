import type {
  AgentStreamEvent,
  StepCompleteData,
  SubAgentProgressData,
} from '@lobechat/agent-gateway-client';
import type { BackgroundTaskEventData } from '@lobechat/heterogeneous-agents';
import { isPermissionModeReport } from '@lobechat/heterogeneous-agents/claudeCodePermission/shared';
import type { ConversationContext } from '@lobechat/types';

import { applyPermissionModeReport } from '@/store/chat/heteroPermissionMode';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { insertSteerMessage } from './streamStartSeed';

/**
 * A `step_complete` that rides the event for something other than a step
 * boundary. `apply` is the store update it asks for (none when it carries
 * nothing to show); the caller enqueues it behind pending refetches.
 */
/**
 * A heterogeneous run's background task snapshot, published by the server after
 * it persisted the same value on the tool message. Applied in memory to the
 * starting tool row; a row not loaded yet gets it from the DB on its refetch.
 */
const applyBackgroundTaskSnapshot = (
  get: () => ChatStore,
  { task, toolCallId }: BackgroundTaskEventData,
  target: {
    context: ConversationContext;
    dispatchContext: { operationId: string };
    operationId: string | undefined;
  },
) => {
  const { context, dispatchContext, operationId } = target;
  const messages = get().dbMessagesMap[messageMapKey(context)] ?? [];
  const toolMessage = messages.find((m) => m.role === 'tool' && m.tool_call_id === toolCallId);
  if (!toolMessage) return;

  get().internal_dispatchMessage(
    {
      id: toolMessage.id,
      key: 'backgroundTask',
      type: 'updatePluginState',
      value: { ...task, ...(operationId && { operationId }) },
    },
    dispatchContext,
  );
};

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
  event: Pick<AgentStreamEvent, 'data' | 'operationId' | 'type'>,
  context: ConversationContext,
  dispatchContext: { operationId: string },
): StepSideEvent | undefined => {
  if (event.type === 'background_task') {
    const snapshot = event.data as BackgroundTaskEventData | undefined;
    if (!snapshot?.toolCallId || !snapshot.task) return {};
    // The server run's operation id: what a stop is routed to.
    const operationId = event.operationId || snapshot.task.operationId;
    return {
      apply: () =>
        applyBackgroundTaskSnapshot(get, snapshot, { context, dispatchContext, operationId }),
    };
  }

  const data = event.data as StepCompleteData | undefined;
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

  // The server already wrote Claude Code's mode onto the topic; the chip follows.
  if (isPermissionModeReport(data)) {
    return {
      apply: () => void applyPermissionModeReport(get, context.topicId, data, { persist: false }),
    };
  }

  if (data?.phase === 'user_message') {
    const steer = data.steerMessage;
    if (!steer) return {};

    return { apply: () => insertSteerMessage(get, steer, context, dispatchContext) };
  }

  return undefined;
};
