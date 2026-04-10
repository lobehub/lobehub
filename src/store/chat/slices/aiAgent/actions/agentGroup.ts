// Disable the auto sort key eslint rule to make the code more logic and readable
import { LOADING_FLAT } from '@lobechat/const';
import { type SendGroupMessageParams } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { lambdaClient } from '@/libs/trpc/client';
import { type StreamEvent } from '@/services/agentRuntime';
import { agentRuntimeClient, agentRuntimeService } from '@/services/agentRuntime';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

const log = debug('store:chat:ai-agent:agentGroup');

const n = setNamespace('aiAgentGroup');
const MAX_STREAM_RECONNECT_ATTEMPTS = 1;

type Setter = StoreSetter<ChatStore>;
export const agentGroupSlice = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ChatGroupChatActionImpl(set, get, _api);

export class ChatGroupChatActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  sendGroupMessage = async ({ context, message, files }: SendGroupMessageParams): Promise<void> => {
    if (!message.trim() && (!files || files.length === 0)) return;

    const { agentId, groupId, topicId } = context;

    if (!agentId || !groupId) {
      log('sendGroupMessage: missing agentId or groupId in context');
      return;
    }

    const { internal_handleAgentStreamEvent, optimisticCreateTmpMessage, startOperation } =
      this.#get();

    log(
      'sendGroupMessage: agentId=%s, groupId=%s, message=%s',
      agentId,
      groupId,
      message.slice(0, 50),
    );

    this.#set({ isCreatingMessage: true }, false, n('sendGroupMessage/start'));

    // 0. Create execServerAgentRuntime operation FIRST for correct loading state
    // This ensures isAgentRuntimeRunningByContext returns true during mutate call
    const tempUserId = 'tmp_' + nanoid();
    const tempAssistantId = 'tmp_' + nanoid();
    const fileIds = files?.map((f) => f.id);

    const { operationId: execOperationId, abortController: execAbortController } = startOperation({
      context: { ...context, messageId: tempUserId },
      label: 'Execute Server Agent',
      type: 'execServerAgentRuntime',
    });

    // 1. Optimistic update - create temp messages immediately for instant UI feedback
    // Pass operationId so internal_dispatchMessage uses the correct context
    optimisticCreateTmpMessage(
      {
        agentId,
        content: message,
        files: fileIds,
        groupId,
        role: 'user',
        topicId: topicId ?? undefined,
      },
      { operationId: execOperationId, tempMessageId: tempUserId },
    );

    // Create temp assistant message (loading state)
    optimisticCreateTmpMessage(
      {
        agentId,
        content: LOADING_FLAT,
        groupId,
        role: 'assistant',
        topicId: topicId ?? undefined,
      },
      { operationId: execOperationId, tempMessageId: tempAssistantId },
    );

    try {
      // 2. Call backend execGroupAgent - creates messages and triggers Agent
      // Pass AbortSignal to allow cancellation during the API call
      const result = await lambdaClient.aiAgent.execGroupAgent.mutate(
        { agentId, files: fileIds, groupId, message, topicId },
        { signal: execAbortController.signal },
      );

      log(
        'execGroupAgent result: operationId=%s, topicId=%s, success=%s',
        result.operationId,
        result.topicId,
        result.success,
      );

      // 3. Update topics if new topic was created
      if (result.topics) {
        const pageSize = 20; // Default page size for topics
        this.#get().internal_updateTopics(agentId, {
          groupId,
          items: result.topics.items as any, // Type from DB may have null vs undefined differences
          pageSize,
          total: result.topics.total,
        });
      }

      // 4. Switch to new topic if created
      if (result.isCreateNewTopic && result.topicId) {
        await this.#get().switchTopic(result.topicId, {
          clearNewKey: true,
          skipRefreshMessage: true,
        });
      }

      // 5. Create execContext with updated topicId from server response
      const execContext = { ...context, topicId: result.topicId || topicId };

      // 6. Replace temp messages with server messages
      // Messages include assistant message with error if operation failed to start
      if (result.messages) {
        this.#get().replaceMessages(result.messages, {
          action: n('sendGroupMessage/syncMessages'),
          context: execContext,
        });
        // Delete temp messages - use execOperationId for correct context
        this.#get().internal_dispatchMessage(
          { ids: [tempUserId, tempAssistantId], type: 'deleteMessages' },
          { operationId: execOperationId },
        );
      }

      // 7. Check if operation failed to start (e.g., QStash unavailable)
      // In this case, messages are synced but we skip SSE connection
      if (result.success === false) {
        log('Agent operation failed to start: %s', result.error);
        // Complete the operation with error status
        this.#get().failOperation(execOperationId, {
          message: result.error || 'Agent operation failed to start',
          type: 'AgentStartupError',
        });
        return;
      }

      // 8. Create streaming context - use assistantMessageId from backend response
      const streamContext = {
        assistantId: result.assistantMessageId,
        content: '',
        reasoning: '',
        receivedTerminalEvent: false,
        tmpAssistantId: tempAssistantId, // Used for cleanup if needed
      };

      let lastEventId = '0';
      let reconnectAttempts = 0;
      let currentStreamConnection: AbortController | undefined;
      let reconnectInFlight = false;
      let streamClosedByClient = false;
      let streamReconciled = false;

      const completeStreamOperations = () => {
        streamReconciled = true;
        this.#get().completeOperation(result.operationId);
        this.#get().completeOperation(execOperationId);
      };

      const failStreamOperations = (message: string) => {
        streamReconciled = true;
        this.#get().failOperation(result.operationId, {
          message,
          type: 'AgentStreamDisconnected',
        });
        this.#get().failOperation(execOperationId, {
          message,
          type: 'AgentStreamDisconnected',
        });
      };

      const reconcileUnexpectedStreamClose = async (error?: Error) => {
        if (reconnectInFlight || streamReconciled) return;
        reconnectInFlight = true;

        try {
          if (streamClosedByClient) return;

          if (streamContext.receivedTerminalEvent) {
            completeStreamOperations();
            return;
          }

          const status = await agentRuntimeService.getOperationStatus(result.operationId, true);
          await this.#get().refreshMessages(execContext);

          // Re-check after async calls — user may have cancelled during the awaits
          if (streamClosedByClient) return;

          if (!status) {
            failStreamOperations(error?.message || 'Agent stream state is no longer available');
            return;
          }

          if (status?.hasError) {
            const errorMessage =
              status.currentState?.error?.message || error?.message || 'Agent runtime failed';
            failStreamOperations(errorMessage);
            return;
          }

          if (status.needsHumanInput || status.isCompleted || !status.isActive) {
            completeStreamOperations();
            return;
          }

          if (reconnectAttempts < MAX_STREAM_RECONNECT_ATTEMPTS) {
            reconnectAttempts += 1;
            log(
              'Stream closed before completion for %s, reconnecting with history from %s (attempt %d)',
              result.operationId,
              lastEventId,
              reconnectAttempts,
            );
            connectStream();
            return;
          }

          failStreamOperations(error?.message || 'Agent stream disconnected before completion');
        } catch (streamError) {
          console.error('Failed to reconcile group agent stream state:', streamError);
          failStreamOperations(error?.message || 'Agent stream disconnected before completion');
        } finally {
          reconnectInFlight = false;
        }
      };

      const connectStream = () => {
        currentStreamConnection = agentRuntimeClient.createStreamConnection(result.operationId, {
          includeHistory: true,
          lastEventId,
          onConnect: () => {
            log('Stream connected to %s from %s', result.operationId, lastEventId);
          },
          onDisconnect: () => {
            log('Stream disconnected from %s', result.operationId);
            void reconcileUnexpectedStreamClose();
          },
          onError: (error: Error) => {
            log('Stream error for %s: %O', result.operationId, error);
            void reconcileUnexpectedStreamClose(error);
          },
          onEvent: async (event: StreamEvent) => {
            lastEventId = event.timestamp.toString();

            if (event.type === 'agent_runtime_end' || event.type === 'stream_end') {
              streamContext.receivedTerminalEvent = true;
            }

            await internal_handleAgentStreamEvent(result.operationId, event, streamContext);
          },
        });
      };

      // 9. Start child operation for SSE stream using backend operationId
      this.#get().startOperation({
        context: { ...execContext, messageId: result.assistantMessageId },
        label: 'Group Agent Stream',
        operationId: result.operationId,
        parentOperationId: execOperationId,
        type: 'groupAgentStream',
      });

      // Associate assistant message with both operations:
      // - execServerAgentRuntime (parent) - for isGenerating detection
      // - groupAgentStream (child) - for stream cancel handling
      this.#get().associateMessageWithOperation(result.assistantMessageId, execOperationId);
      this.#get().associateMessageWithOperation(result.assistantMessageId, result.operationId);

      // 10. Connect to SSE stream.
      // Enable history replay so fast operations don't outrun the client connection.
      connectStream();

      // 11. Register cancel handler for aborting SSE stream
      this.#get().onOperationCancel(result.operationId, () => {
        log('Cancelling SSE stream for operation %s', result.operationId);
        streamClosedByClient = true;
        currentStreamConnection?.abort();
      });
    } catch (error) {
      // Check if this is an abort error (user cancelled the operation)
      const isAbortError =
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.message.includes('aborted') ||
          error.message.includes('cancelled'));

      if (isAbortError) {
        log('sendGroupMessage aborted by user');
        // Operation was cancelled by user, status already updated by cancelOperation
        // Just clean up temp messages
        this.#get().internal_dispatchMessage(
          {
            ids: [tempUserId, tempAssistantId],
            type: 'deleteMessages',
          },
          { operationId: execOperationId },
        );
      } else {
        log('sendGroupMessage failed: %O', error);
        console.error('Failed to send group message:', error);

        // Remove temp messages on error - use execOperationId for correct context
        this.#get().internal_dispatchMessage(
          {
            ids: [tempUserId, tempAssistantId],
            type: 'deleteMessages',
          },
          { operationId: execOperationId },
        );

        // Fail the execServerAgentRuntime operation
        this.#get().failOperation(execOperationId, {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'SendGroupMessageError',
        });
      }
    } finally {
      this.#set({ isCreatingMessage: false }, false, n('sendGroupMessage/end'));
    }
  };
}

export type ChatGroupChatAction = Pick<ChatGroupChatActionImpl, keyof ChatGroupChatActionImpl>;
