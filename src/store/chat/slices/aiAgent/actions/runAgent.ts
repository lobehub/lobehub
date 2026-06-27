import { type ChatToolPayload } from '@lobechat/types';
import debug from 'debug';

import { type StreamEvent } from '@/services/agentRuntime';
import { agentRuntimeService } from '@/services/agentRuntime';
import { type ChatStore } from '@/store/chat/store';
import {
  notifyDesktopAgentCompleted,
  notifyDesktopHumanApprovalRequired,
} from '@/store/chat/utils/desktopNotification';
import { type StoreSetter } from '@/store/types';

const log = debug('store:chat:ai-agent:runAgent');

interface StreamingContext {
  assistantId: string;
  content: string;
  reasoning: string;
  tmpAssistantId: string;
  toolsCalling?: ChatToolPayload[];
}

type Setter = StoreSetter<ChatStore>;
export const agentSlice = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new AgentActionImpl(set, get, _api);

export class AgentActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  internal_cleanupAgentOperation = (assistantId: string): void => {
    // Find operation by messageId (assistantId)
    const messageOpId = this.#get().messageOperationMap[assistantId];
    if (!messageOpId) {
      log(`No operation found for assistant message ${assistantId}`);
      return;
    }

    log(`Cleaning up agent operation for ${assistantId} (operationId: ${messageOpId})`);

    // Cancel the operation (this will trigger the cancel handler which aborts the SSE stream)
    this.#get().cancelOperation(messageOpId, 'Cleanup requested');
  };

  internal_handleAgentError = (assistantId: string, errorMessage: string): void => {
    log(`Agent error for ${assistantId}: ${errorMessage}`);

    // Find operation by messageId (assistantId) and fail it
    const messageOpId = this.#get().messageOperationMap[assistantId];
    if (messageOpId) {
      this.#get().failOperation(messageOpId, {
        message: errorMessage,
        type: 'AgentExecutionError',
      });
    }

    // Update error state in frontend only (backend already persists the error)
    this.#get().internal_dispatchMessage({
      id: assistantId,
      type: 'updateMessage',
      value: {
        error: {
          message: errorMessage,
          type: 'UnknownError' as any,
        },
      },
    });

    // Stop loading state
    // Clean up operation (this will cancel the operation)
    this.#get().internal_cleanupAgentOperation(assistantId);
  };

  internal_handleAgentStreamEvent = async (
    operationId: string,
    event: StreamEvent,
    context: StreamingContext,
  ): Promise<void> => {
    const { internal_dispatchMessage } = this.#get();
    const operation = this.#get().operations[operationId];
    if (!operation) {
      log(`No operation found for ${operationId}, ignoring event ${event.type}`);
      return;
    }

    // Update operation metadata
    this.#get().updateOperationMetadata(operationId, {
      lastEventId: event.timestamp.toString(),
      stepCount: event.stepIndex,
    });

    const assistantId = context.assistantId || context.tmpAssistantId;
    log(`assistantMessageId: ${assistantId}`);

    switch (event.type) {
      case 'connected': {
        log(`Agent stream connected for ${assistantId}`);
        break;
      }

      case 'heartbeat': {
        // Heartbeat event, keeps the connection alive
        break;
      }

      case 'agent_runtime_init': {
        // Agent runtime initialization event
        log(`Agent runtime initialized for ${assistantId}:`, event.data);
        break;
      }

      case 'agent_runtime_end': {
        // Agent runtime finished - this is the definitive signal that generation is complete
        const { reason, reasonDetail, finalState, uiMessages } = event.data || {};
        log(`Agent runtime ended for ${assistantId}: reason=${reason}, detail=${reasonDetail}`);

        // Server pushes the canonical UIChatMessage[] snapshot for the
        // topic as the Source of Truth on terminal-state. The last step
        // has no later step_start to carry a fresh snapshot, so without
        // this branch the streamed assistantGroup would only be reconciled
        // with DB once a refetch fires — losing the SoT guarantee.
        if (Array.isArray(uiMessages)) {
          log(`Replacing messages from agent_runtime_end uiMessages (${uiMessages.length} msgs)`);
          this.#get().replaceMessages(uiMessages, { context: operation.context });
        }

        // Update operation metadata with final state
        if (finalState) {
          this.#get().updateOperationMetadata(operationId, {
            finalStatus: finalState.status || reason,
          });
        }

        // Stop loading state
        log(`Stopping loading for completed agent runtime: ${assistantId}`);

        break;
      }

      case 'stream_start': {
        // If assistantId is already set (Group Chat flow), skip message creation/deletion
        // In Group Chat, messages are already synced via replaceMessages from backend response
        if (context.assistantId) {
          log(`Stream started for ${context.assistantId} (message already synced from backend)`);
          break;
        }

        // Original logic for normal Agent flow
        log(`Stream started for ${assistantId}:`, event.data);
        internal_dispatchMessage({
          id: context.tmpAssistantId,
          type: 'deleteMessage',
        });

        context.assistantId = event.data.assistantMessage.id;

        internal_dispatchMessage({
          id: context.assistantId,
          type: 'createMessage',
          value: event.data.assistantMessage,
        });

        break;
      }

      case 'stream_chunk': {
        // Handle streaming content chunk
        const { chunkType } = event.data || {};

        switch (chunkType) {
          case 'text': {
            // Update text content
            context.content += event.data.content;
            log(`Stream(${event.operationId}) chunk type=${chunkType}: `, event.data.content);

            internal_dispatchMessage({
              id: assistantId,
              type: 'updateMessage',
              value: { content: context.content },
            });
            break;
          }

          case 'reasoning': {
            // Update text content
            context.reasoning += event.data.reasoning;
            log(`Stream(${event.operationId}) chunk type=${chunkType}: `, event.data.reasoning);

            internal_dispatchMessage({
              id: assistantId,
              type: 'updateMessage',
              value: { reasoning: { content: context.reasoning } },
            });
            break;
          }

          case 'tools_calling': {
            context.toolsCalling = event.data.toolsCalling;

            internal_dispatchMessage({
              id: assistantId,
              type: 'updateMessage',
              value: { tools: context.toolsCalling },
            });
            break;
          }
        }

        break;
      }

      case 'stream_end': {
        // Stream ended, update final content
        const { finalContent, toolCalls, reasoning, imageList, grounding } = event.data || {};
        log(`Stream ended for ${assistantId}:`, {
          hasFinalContent: !!finalContent,
          hasGrounding: !!grounding,
          hasImageList: !!(imageList && imageList.length > 0),
          hasReasoning: !!reasoning,
          hasToolCalls: !!(toolCalls && toolCalls.length > 0),
        });

        // Update frontend UI only (backend already persists all data)
        if (finalContent !== undefined) {
          internal_dispatchMessage({
            id: assistantId,
            type: 'updateMessage',
            value: {
              content: finalContent,
              ...(toolCalls && toolCalls.length > 0 ? { tools: toolCalls } : {}),
              ...(reasoning ? { reasoning } : {}),
              ...(imageList && imageList.length > 0 ? { imageList } : {}),
              ...(grounding ? { search: grounding } : {}),
            },
          });
        }

        // Stop loading state
        log(`Stopping loading for ${assistantId}`);

        // Show desktop notification — unified completion notification: title =
        // topic/agent name, body = the actual reply, click deep-links to the
        // conversation. The helper no-ops off-desktop and resolves title/body
        // from the operation context + final content.
        await notifyDesktopAgentCompleted(this.#get, {
          content: finalContent,
          context: operation.context,
        });

        // Mark unread completion for background agents
        const op = this.#get().operations[operationId];
        if (op?.context.agentId) {
          this.#get().markTopicUnread({
            agentId: op.context.agentId,
            groupId: op.context.groupId,
            topicId: op.context.topicId,
          });
        }
        break;
      }

      case 'step_start': {
        const { phase, toolCall, pendingToolsCalling, requiresApproval, uiMessages } =
          event.data || {};

        // Server attaches the canonical UIChatMessage[] snapshot to
        // step_start so the client uses the pushed payload as Source of
        // Truth instead of refetching from DB (the DB fan-out from the
        // previous step's stream chunks is async — a refetch here would
        // return a stale assistant placeholder that clobbers the
        // streamed assistantGroup).
        if (Array.isArray(uiMessages)) {
          log(`Replacing messages from step_start uiMessages (${uiMessages.length} msgs)`);
          this.#get().replaceMessages(uiMessages, { context: operation.context });
        }

        if (phase === 'human_approval' && requiresApproval) {
          // Requires human approval
          log(`Human approval required for ${assistantId}:`, pendingToolsCalling);
          this.#get().updateOperationMetadata(operationId, {
            needsHumanInput: true,
            pendingApproval: pendingToolsCalling,
          });

          await notifyDesktopHumanApprovalRequired(this.#get, operation.context);

          // Stop loading state, waiting for human intervention
          log(`Stopping loading for human approval: ${assistantId}`);
        } else if (phase === 'tool_execution' && toolCall) {
          log(`Tool execution started for ${assistantId}: ${toolCall.function?.name}`);
        }
        break;
      }

      case 'step_complete': {
        const { phase, result, executionTime, finalState } = event.data || {};

        if (phase === 'tool_execution' && result) {
          log(`Tool execution completed for ${assistantId} in ${executionTime}ms:`, result);
          // Tool results are reconciled via the canonical uiMessages
          // snapshot the server pushes on the next step_start; no need
          // to refetch from DB here (the refetch was the source of the
          // assistantGroup-clobber regression.
        } else if (phase === 'execution_complete' && finalState) {
          // Agent execution complete
          log(`Agent execution completed for ${assistantId}:`, finalState);
          this.#get().updateOperationMetadata(operationId, {
            finalStatus: finalState.status,
          });

          log(`Stopping loading for completed agent: ${assistantId}`);
        }
        break;
      }

      case 'error': {
        const { error, message, phase } = event.data || {};
        log(`Error in ${phase} for ${assistantId}:`, error);
        this.#get().internal_handleAgentError(
          assistantId,
          message || error || 'Unknown agent error',
        );
        break;
      }

      default: {
        log(`Handling event ${event.type} for ${assistantId}:`, event);
        break;
      }
    }
  };

  internal_handleHumanIntervention = async (
    assistantId: string,
    action: string,
    data?: any,
  ): Promise<void> => {
    // Find operation by messageId (assistantId)
    const messageOpId = this.#get().messageOperationMap[assistantId];
    if (!messageOpId) {
      log(`No operation found for assistant message ${assistantId}`);
      return;
    }

    const operation = this.#get().operations[messageOpId];
    if (!operation || !operation.metadata.needsHumanInput) {
      log(`No human intervention needed for operation ${messageOpId}`);
      return;
    }

    try {
      log(`Handling human intervention ${action} for operation ${messageOpId}:`, data);

      // Send human intervention request
      await agentRuntimeService.handleHumanIntervention({
        action: action as any,
        data,
        operationId: messageOpId,
      });

      // Clear human intervention state
      this.#get().updateOperationMetadata(messageOpId, {
        needsHumanInput: false,
        pendingApproval: undefined,
        pendingPrompt: undefined,
        pendingSelect: undefined,
      });

      log(`Human intervention ${action} processed for operation ${messageOpId}`);
    } catch (error) {
      log(`Failed to handle human intervention for operation ${messageOpId}:`, error);
      this.#get().internal_handleAgentError(
        assistantId,
        `Human intervention failed: ${(error as Error).message}`,
      );
    }
  };
}

export type AgentAction = Pick<AgentActionImpl, keyof AgentActionImpl>;
