import { isDesktop } from '@lobechat/const';
import { type ChatToolPayload } from '@lobechat/types';
import debug from 'debug';
import i18n from 'i18next';

import { type StreamEvent } from '@/services/agentRuntime';
import { agentRuntimeService } from '@/services/agentRuntime';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { type ChatStore } from '@/store/chat/store';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
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
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
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

    // 停止 loading 状态
    this.#get().internal_toggleMessageLoading(false, assistantId);

    // 清理操作 (this will cancel the operation)
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

    // 更新操作元数据
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
        // 心跳事件，保持连接活跃
        break;
      }

      case 'agent_runtime_init': {
        // Agent runtime initialization event
        log(`Agent runtime initialized for ${assistantId}:`, event.data);
        break;
      }

      case 'agent_runtime_end': {
        // Agent runtime finished - this is the definitive signal that generation is complete
        const { reason, reasonDetail, finalState } = event.data || {};
        log(`Agent runtime ended for ${assistantId}: reason=${reason}, detail=${reasonDetail}`);

        // Update operation metadata with final state
        if (finalState) {
          this.#get().updateOperationMetadata(operationId, {
            finalStatus: finalState.status || reason,
          });
        }

        // Stop loading state
        log(`Stopping loading for completed agent runtime: ${assistantId}`);
        this.#get().internal_toggleMessageLoading(false, assistantId);
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
        // 处理流式内容块
        const { chunkType } = event.data || {};

        switch (chunkType) {
          case 'text': {
            // 更新文本内容
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
            // 更新文本内容
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
        // 流式结束，更新最终内容
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

        // 停止 loading 状态
        log(`Stopping loading for ${assistantId}`);
        this.#get().internal_toggleMessageLoading(false, assistantId);

        // 显示桌面通知
        if (isDesktop) {
          try {
            const { desktopNotificationService } =
              await import('@/services/electron/desktopNotification');

            // Use topic title or agent title as notification title
            let notificationTitle = i18n.t('desktopNotification.aiReplyCompleted.title', {
              ns: 'chat',
            });
            const opCtx = operation.context;
            if (opCtx.topicId && opCtx.agentId) {
              const key = topicMapKey({ agentId: opCtx.agentId, groupId: opCtx.groupId });
              const topicData = this.#get().topicDataMap[key];
              const topic = topicData?.items?.find((item) => item.id === opCtx.topicId);
              if (topic?.title) notificationTitle = topic.title;
            } else if (opCtx.agentId) {
              const agentMeta = agentSelectors.getAgentMetaById(opCtx.agentId)(
                getAgentStoreState(),
              );
              if (agentMeta?.title) notificationTitle = agentMeta.title;
            }

            await desktopNotificationService.showNotification({
              body: i18n.t('desktopNotification.aiReplyCompleted.body', { ns: 'chat' }),
              title: notificationTitle,
            });
          } catch (error) {
            console.error('Desktop notification error:', error);
          }
        }

        // Mark unread completion for background agents
        const op = this.#get().operations[operationId];
        if (op?.context.agentId) {
          this.#get().markUnreadCompleted(op.context.agentId, op.context.topicId);
        }
        break;
      }

      case 'step_start': {
        const { phase, toolCall, pendingToolsCalling, requiresApproval } = event.data || {};

        if (phase === 'human_approval' && requiresApproval) {
          // 需要人工批准
          log(`Human approval required for ${assistantId}:`, pendingToolsCalling);
          this.#get().updateOperationMetadata(operationId, {
            needsHumanInput: true,
            pendingApproval: pendingToolsCalling,
          });

          // 停止 loading 状态，等待人工干预
          log(`Stopping loading for human approval: ${assistantId}`);
          this.#get().internal_toggleMessageLoading(false, assistantId);
        } else if (phase === 'tool_execution' && toolCall) {
          log(`Tool execution started for ${assistantId}: ${toolCall.function?.name}`);
        }
        break;
      }

      case 'step_complete': {
        const { phase, result, executionTime, finalState } = event.data || {};

        if (phase === 'tool_execution' && result) {
          log(`Tool execution completed for ${assistantId} in ${executionTime}ms:`, result);
          // 刷新消息以显示工具结果
          await this.#get().refreshMessages();
        } else if (phase === 'execution_complete' && finalState) {
          // Agent 执行完成
          log(`Agent execution completed for ${assistantId}:`, finalState);
          this.#get().updateOperationMetadata(operationId, {
            finalStatus: finalState.status,
          });

          log(`Stopping loading for completed agent: ${assistantId}`);
          this.#get().internal_toggleMessageLoading(false, assistantId);
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

      // 发送人工干预请求
      await agentRuntimeService.handleHumanIntervention({
        action: action as any,
        data,
        operationId: messageOpId,
      });

      // 重新开始 loading 状态
      this.#get().internal_toggleMessageLoading(true, assistantId);

      // 清除人工干预状态
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
