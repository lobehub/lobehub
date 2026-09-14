import type { AgentHookEvent, AgentState } from '@lobechat/agent-runtime';
import { ThreadStatus } from '@lobechat/types';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';
import type { ThreadModel } from '@/database/models/thread';
import type { AgentRuntimeService } from '@/server/services/agentRuntime';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import type {
  GroupActionMemberMode,
  GroupActionOnComplete,
  StepCompletionReason,
  StepLifecycleCallbacks,
} from '@/server/services/agentRuntime/types';

import { formatErrorForMetadata } from '../helpers/groupContext';

const log = debug('lobe-server:ai-agent-service');

export function calculateTotalTokens(usage?: AgentState['usage']): number | undefined {
  if (!usage) return undefined;
  return usage.llm?.tokens?.total;
}

/**
 * Create step lifecycle callbacks for updating Thread metadata
 * These callbacks accumulate metrics during execution and update Thread on completion
 *
 * @param threadId - The Thread ID to update
 * @param startedAt - The start time ISO string
 * @param sourceMessageId - The source message ID from Thread to update with summary
 */
export function createThreadMetadataCallbacks(
  threadModel: ThreadModel,
  messageModel: MessageModel,
  threadId: string,
  startedAt: string,
  sourceMessageId: string,
  logScope: 'execSubAgent' | 'execVirtualSubAgent' = 'execSubAgent',
): StepLifecycleCallbacks {
  // Accumulator for tracking metrics across steps
  let accumulatedToolCalls = 0;

  return {
    onAfterStep: async ({ state, stepResult }: { state: AgentState; stepResult?: any }) => {
      // Count tool calls from this step
      const toolCallsInStep = stepResult?.events?.filter(
        (e: { type: string }) => e.type === 'tool_call',
      )?.length;
      if (toolCallsInStep) {
        accumulatedToolCalls += toolCallsInStep;
      }

      // Update Thread metadata with current progress
      try {
        await threadModel.update(threadId, {
          metadata: {
            operationId: state.operationId,
            startedAt,
            totalMessages: state.messages?.length ?? 0,
            totalTokens: calculateTotalTokens(state.usage),
            totalToolCalls: accumulatedToolCalls,
          },
        });
        log('%s: updated thread %s metadata after step %d', logScope, threadId, state.stepCount);
      } catch (error) {
        log('%s: failed to update thread metadata: %O', logScope, error);
      }
    },

    onComplete: async ({
      finalState,
      reason,
    }: {
      finalState: AgentState;
      reason: StepCompletionReason;
    }) => {
      const completedAt = new Date().toISOString();
      const duration = Date.now() - new Date(startedAt).getTime();

      // Determine thread status based on completion reason
      let status: ThreadStatus;
      switch (reason) {
        case 'done': {
          status = ThreadStatus.Completed;
          break;
        }
        case 'error': {
          status = ThreadStatus.Failed;
          break;
        }
        case 'interrupted': {
          status = ThreadStatus.Cancel;
          break;
        }
        case 'waiting_for_human': {
          status = ThreadStatus.InReview;
          break;
        }
        default: {
          status = ThreadStatus.Completed;
        }
      }

      // Log error when the isolated run fails
      if (reason === 'error' && finalState.error) {
        console.error('%s: run failed for thread %s:', logScope, threadId, finalState.error);
      }

      try {
        // Extract summary from last assistant message and update source message content
        const lastAssistantMessage = finalState.messages
          ?.slice()
          .reverse()
          .find((m: { role: string }) => m.role === 'assistant');

        if (lastAssistantMessage?.content) {
          await messageModel.update(sourceMessageId, {
            content: lastAssistantMessage.content,
          });
          log('%s: updated source message %s with summary', logScope, sourceMessageId);
        }

        // Format error for proper serialization (Error objects don't serialize with JSON.stringify)
        const formattedError = formatErrorForMetadata(finalState.error);

        // Update Thread metadata
        await threadModel.update(threadId, {
          metadata: {
            completedAt,
            duration,
            error: formattedError,
            operationId: finalState.operationId,
            startedAt,
            totalCost: finalState.cost?.total,
            totalMessages: finalState.messages?.length ?? 0,
            totalTokens: calculateTotalTokens(finalState.usage),
            totalToolCalls: accumulatedToolCalls,
          },
          status,
        });

        log(
          '%s: thread %s completed with status %s, reason: %s',
          logScope,
          threadId,
          status,
          reason,
        );
      } catch (error) {
        console.error('%s: failed to update thread on completion: %O', logScope, error);
      }
    },
  };
}

/** Create hooks for tracking Thread metadata updates during SubAgent execution. */
export function createThreadHooks(
  agentRuntimeService: AgentRuntimeService,
  threadModel: ThreadModel,
  messageModel: MessageModel,
  threadId: string,
  startedAt: string,
  sourceMessageId: string,
  logScope: 'execSubAgent' | 'execVirtualSubAgent',
): AgentHook[] {
  let accumulatedToolCalls = 0;

  return [
    {
      handler: async (event: AgentHookEvent) => {
        const state = event.finalState;
        if (!state) return;

        // Count tool calls from step result
        const stepToolCalls = state.session?.toolCalls || 0;
        if (stepToolCalls > accumulatedToolCalls) {
          accumulatedToolCalls = stepToolCalls;
        }

        try {
          await threadModel.update(threadId, {
            metadata: {
              operationId: event.operationId,
              startedAt,
              totalMessages: state.messages?.length ?? 0,
              totalTokens: calculateTotalTokens(state.usage),
              totalToolCalls: accumulatedToolCalls,
            },
          });
        } catch (error) {
          log('%s: thread hook afterStep failed to update metadata: %O', logScope, error);
        }
      },
      id: 'thread-metadata-update',
      type: 'afterStep' as const,
    },
    {
      handler: async (event: AgentHookEvent) => {
        const finalState = event.finalState;
        if (!finalState) return;

        const completedAt = new Date().toISOString();
        const duration = Date.now() - new Date(startedAt).getTime();

        // Map completion reason to ThreadStatus
        let status: ThreadStatus;
        switch (event.reason) {
          case 'done': {
            status = ThreadStatus.Completed;
            break;
          }
          case 'error': {
            status = ThreadStatus.Failed;
            break;
          }
          case 'interrupted': {
            status = ThreadStatus.Cancel;
            break;
          }
          case 'waiting_for_human': {
            status = ThreadStatus.InReview;
            break;
          }
          default: {
            status = ThreadStatus.Completed;
          }
        }

        if (event.reason === 'error' && finalState.error) {
          console.error(
            '%s: thread hook onComplete run failed for thread %s:',
            logScope,
            threadId,
            finalState.error,
          );
        }

        try {
          // Update source message with summary
          const lastAssistantMessage = finalState.messages
            ?.slice()
            .reverse()
            .find((m: { role: string }) => m.role === 'assistant');

          if (lastAssistantMessage?.content) {
            await messageModel.update(sourceMessageId, {
              content: lastAssistantMessage.content,
            });
          }

          const formattedError = formatErrorForMetadata(finalState.error);

          await threadModel.update(threadId, {
            metadata: {
              completedAt,
              duration,
              error: formattedError,
              operationId: finalState.operationId,
              startedAt,
              totalCost: finalState.cost?.total,
              totalMessages: finalState.messages?.length ?? 0,
              totalTokens: calculateTotalTokens(finalState.usage),
              totalToolCalls: accumulatedToolCalls,
            },
            status,
          });

          log(
            '%s: thread hook onComplete thread %s status=%s reason=%s',
            logScope,
            threadId,
            status,
            event.reason,
          );
        } catch (error) {
          console.error('%s: thread hook onComplete failed to update: %O', logScope, error);
        }
      },
      id: 'thread-completion',
      type: 'onComplete' as const,
    },
  ];
}

/**
   * Completion bridge for the server `callSubAgent` deferred-tool path.
   *
   * Fires on the sub-op's completion (success or failure) and delegates to
   * `AgentRuntimeService.completeSubAgentBridge`: backfill the parent's
   * placeholder tool message, then barrier-check + CAS-resume the parked
   * parent op.
   *
   * Transport adapts to the runtime mode like every other lifecycle hook:
   *   - local mode: the `handler` runs in-process with the child's finalState.
   *   - queue mode: in-memory handlers don't survive cross-process steps, so
   *     the serialized `webhook` config is delivered via QStash to
   *     `/api/agent/webhooks/subagent-callback`, which re-enters the same
   *     bridge method. `delivery: 'qstash'` is required — a plain fetch would


   *     be rejected by the endpoint's QStash signature auth.
   */
export function createSubAgentBridgeHook(
  agentRuntimeService: AgentRuntimeService,
  parentOperationId: string,
  toolMessageId: string,
  threadId: string,
): AgentHook {
  return {
    handler: async (event: AgentHookEvent) => {
      try {
        await agentRuntimeService.completeSubAgentBridge({
          finalState: event.finalState,
          operationId: event.operationId,
          parentOperationId,
          reason: event.reason ?? 'done',
          threadId,
          toolMessageId,
        });
      } catch (error) {
        console.error(
          'Sub-agent bridge: failed to complete bridge for parent %s: %O',
          parentOperationId,
          error,
        );
      }
    },
    id: 'sub-agent-bridge',
    type: 'onComplete' as const,
    webhook: {
      body: { parentOperationId, threadId, toolMessageId },
      delivery: 'qstash' as const,
      // Keep the payload lean: the endpoint reloads the child's final state
      // from the coordinator, so everything beyond these ids is dead weight.
      // The default (all event fields) would ship the child's entire final
      // answer (`lastAssistantContent`) — and any tool-produced attachments
      // the shared lifecycle event extractor inlines — through QStash.
      eventFields: ['operationId', 'reason', 'status'],
      // The endpoint sits behind QStash signature auth, so the unsigned
      // fetch fallback could never authenticate — it would only mask a
      // publish failure as a silently-dropped 401, stranding the parent.
      fallback: 'none' as const,
      url: '/api/agent/webhooks/subagent-callback',
    },
  };
}

/**
   * Completion bridge for the group orchestration "call agent member" path.
   *
   * Fires on a member op's completion and delegates to
   * `AgentRuntimeService.completeGroupActionMember`: backfill the member anchor,


   * enforce the K=N member barrier, then resume/finish the parked supervisor.
   * Transport mirrors {@link createSubAgentBridgeHook} — in-process in local
   * mode, QStash → `/api/agent/webhooks/group-member-callback` in queue mode.
   */
export function createGroupActionMemberBridgeHook(
  agentRuntimeService: AgentRuntimeService,
  params: {
    anchorMessageId: string;
    expectedMembers: number;
    groupToolMessageId: string;
    mode: GroupActionMemberMode;
    onComplete: GroupActionOnComplete;
    parentOperationId: string;
    threadId?: string;
  },
): AgentHook {
  const {
    anchorMessageId,
    expectedMembers,
    groupToolMessageId,
    mode,
    onComplete,
    parentOperationId,
    threadId,
  } = params;
  return {
    handler: async (event: AgentHookEvent) => {
      try {
        await agentRuntimeService.completeGroupActionMember({
          anchorMessageId,
          expectedMembers,
          finalState: event.finalState,
          groupToolMessageId,
          mode,
          onComplete,
          operationId: event.operationId,
          parentOperationId,
          reason: event.reason ?? 'done',
          threadId,
        });
      } catch (error) {
        console.error(
          'Group-member bridge: failed to complete bridge for parent %s: %O',
          parentOperationId,
          error,
        );
      }
    },
    id: 'group-member-bridge',
    type: 'onComplete' as const,
    webhook: {
      body: {
        anchorMessageId,
        expectedMembers,
        groupToolMessageId,
        mode,
        onComplete,
        parentOperationId,
        threadId,
      },
      delivery: 'qstash' as const,
      eventFields: ['operationId', 'reason', 'status'],
      fallback: 'none' as const,
      url: '/api/agent/webhooks/group-member-callback',
    },
  };
}

/**
 * Calculate total tokens from AgentState usage object
 * AgentState.usage is of type Usage from @lobechat/agent-runtime
 */
