import {
  type AgentEvent,
  type AgentInstruction,
  type AgentInstructionCallLlm,
  type AgentInstructionCallTool,
  type AgentInstructionCompressContext,
  type AgentInstructionExecClientTask,
  type AgentInstructionExecClientTasks,
  type AgentInstructionExecTask,
  type AgentInstructionExecTasks,
  type AgentRuntimeContext,
  type GeneralAgentCallingToolInstructionPayload,
  type GeneralAgentCallLLMInstructionPayload,
  type GeneralAgentCallLLMResultPayload,
  type GeneralAgentCallToolResultPayload,
  type GeneralAgentCompressionResultPayload,
  type InstructionExecutor,
  type TaskResultPayload,
  type TasksBatchResultPayload,
} from '@lobechat/agent-runtime';
import { calculateMessageTokens, UsageCounter } from '@lobechat/agent-runtime';
import { isDesktop } from '@lobechat/const';
import { chainCompressContext } from '@lobechat/prompts';
import {
  type ChatToolPayload,
  type ConversationContext,
  type CreateMessageParams,
} from '@lobechat/types';
import debug from 'debug';
import pMap from 'p-map';

import { LOADING_FLAT } from '@/const/message';
import { aiAgentService } from '@/services/aiAgent';
import { chatService } from '@/services/chat';
import { type ResolvedAgentConfig } from '@/services/chat/mecha';
import { messageService } from '@/services/message';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { type ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { sleep } from '@/utils/sleep';

const log = debug('lobe-store:agent-executors');

// Tool pricing configuration (USD per call)
const TOOL_PRICING: Record<string, number> = {
  'lobe-web-browsing/craw': 0.002,
  'lobe-web-browsing/search': 0.001,
};

/**
 * Creates custom executors for the Chat Agent Runtime
 * These executors wrap existing chat store methods to integrate with agent-runtime
 *
 * @param context.operationId - Operation ID to get business context (agentId, topicId, etc.)
 * @param context.get - Store getter function
 * @param context.messageKey - Message map key
 * @param context.parentId - Parent message ID
 * @param context.skipCreateFirstMessage - Skip first message creation
 */
export const createAgentExecutors = (context: {
  /** Pre-resolved agent config with isSubTask filtering applied */
  agentConfig: ResolvedAgentConfig;
  get: () => ChatStore;
  messageKey: string;
  operationId: string;
  parentId: string;
  skipCreateFirstMessage?: boolean;
}) => {
  let shouldSkipCreateMessage = context.skipCreateFirstMessage;

  /**
   * Get operation context via closure
   * Returns the business context (agentId, topicId, etc.) captured by the operation
   */
  const getOperationContext = () => {
    const operation = context.get().operations[context.operationId];
    if (!operation) {
      throw new Error(`Operation not found: ${context.operationId}`);
    }
    return operation.context;
  };

  /**
   * Get effective agentId for message creation
   * In Group Orchestration scenarios, subAgentId is the actual executing agent
   * Falls back to agentId for normal scenarios
   */
  const getEffectiveAgentId = () => {
    const opContext = getOperationContext();
    return opContext.subAgentId || opContext.agentId;
  };

  /* eslint-disable sort-keys-fix/sort-keys-fix */
  const executors: Partial<Record<AgentInstruction['type'], InstructionExecutor>> = {
    /**
     * Custom call_llm executor
     * Creates assistant message and calls internal_fetchAIChatMessage
     */
    call_llm: async (instruction, state, runtimeContext) => {
      const sessionLogId = `${state.operationId}:${state.stepCount}`;
      const stagePrefix = `[${sessionLogId}][call_llm]`;

      const llmPayload = (instruction as AgentInstructionCallLlm)
        .payload as GeneralAgentCallLLMInstructionPayload;

      log(
        `${stagePrefix} Starting session. Input: state.messages=%d, llmPayload.messages=%d, messageKey=%s`,
        state.messages.length,
        llmPayload.messages.length,
        context.messageKey,
      );

      let assistantMessageId: string;

      // Check if we should skip message creation:
      // - shouldSkipCreateMessage is true (e.g., regenerate mode)
      // - BUT if createAssistantMessage is explicitly true, always create new message
      //   (e.g., after compression we need a new assistant message)
      if (shouldSkipCreateMessage && !llmPayload.createAssistantMessage) {
        // Skip first creation, subsequent calls will not skip
        assistantMessageId = context.parentId;
        shouldSkipCreateMessage = false;
      } else {
        // Get context from operation
        const opContext = getOperationContext();
        // Get effective agentId (subAgentId for group orchestration, agentId otherwise)
        const effectiveAgentId = getEffectiveAgentId();

        // If this is the first regenerated creation of userMessage, llmPayload doesn't have parentMessageId
        // So we assign it this way
        // TODO: Maybe this should be implemented with an init method in the future
        if (!llmPayload.parentMessageId) {
          llmPayload.parentMessageId = context.parentId;
        }
        // Create assistant message (following server-side pattern)
        // If isSupervisor is true, add metadata.isSupervisor for UI rendering
        const assistantMessageItem = await context.get().optimisticCreateMessage(
          {
            content: LOADING_FLAT,
            groupId: opContext.groupId,
            metadata: opContext.isSupervisor ? { isSupervisor: true } : undefined,
            model: llmPayload.model,
            parentId: llmPayload.parentMessageId,
            provider: llmPayload.provider,
            role: 'assistant',
            agentId: effectiveAgentId!,
            threadId: opContext.threadId,
            topicId: opContext.topicId ?? undefined,
          },
          { operationId: context.operationId },
        );

        if (!assistantMessageItem) {
          throw new Error('Failed to create assistant message');
        }
        assistantMessageId = assistantMessageItem.id;

        // Associate the assistant message with the operation for UI loading states
        context.get().associateMessageWithOperation(assistantMessageId, context.operationId);
      }

      log(`${stagePrefix} Created assistant message, id: %s`, assistantMessageId);

      log(
        `${stagePrefix} calling model-runtime chat (model: %s, messages: %d, tools: %d)`,
        llmPayload.model,
        llmPayload.messages.length,
        llmPayload.tools?.length ?? 0,
      );

      // Call existing internal_fetchAIChatMessage
      // This method already handles:
      // - Stream processing (text, tool_calls, reasoning, grounding, base64_image)
      // - UI updates via dispatchMessage
      // - Loading state management
      // - Error handling
      // Use messages from state (already contains full conversation history)
      const messages = llmPayload.messages.filter((message) => message.id !== assistantMessageId);
      const {
        isFunctionCall,
        content,
        tools,
        usage: currentStepUsage,
        tool_calls,
        finishType,
      } = await context.get().internal_fetchAIChatMessage({
        messageId: assistantMessageId,
        messages,
        model: llmPayload.model,
        provider: llmPayload.provider,
        operationId: context.operationId,
        agentConfig: context.agentConfig, // Pass pre-resolved config
        // Pass runtime context for page editor injection
        initialContext: runtimeContext?.initialContext,
        stepContext: runtimeContext?.stepContext,
      });

      log(`[${sessionLogId}] finish model-runtime calling`);

      // Get latest messages from store (already updated by internal_fetchAIChatMessage)
      const latestMessages = context.get().dbMessagesMap[context.messageKey] || [];

      log(
        `${stagePrefix} After fetch: dbMessagesMap[${context.messageKey}]=%d messages, available keys=%o`,
        latestMessages.length,
        Object.keys(context.get().dbMessagesMap),
      );

      // Get updated assistant message to extract usage/cost information
      const assistantMessage = latestMessages.find((m) => m.id === assistantMessageId);

      const toolCalls = tools || [];

      // Log llm result
      if (content) {
        log(`[${sessionLogId}][content]`, content);
      }
      if (assistantMessage?.reasoning?.content) {
        log(`[${sessionLogId}][reasoning]`, assistantMessage.reasoning.content);
      }
      if (toolCalls.length > 0) {
        log(`[${sessionLogId}][toolsCalling] `, toolCalls);
      }

      // Log usage
      if (currentStepUsage) {
        log(`[${sessionLogId}][usage] %O`, currentStepUsage);
      }

      log(
        '[%s:%d] call_llm completed, finishType: %s, outputMessages: %d',
        state.operationId,
        state.stepCount,
        finishType,
        latestMessages.length,
      );

      // Accumulate usage and cost to state
      const newState = { ...state, messages: latestMessages };

      if (currentStepUsage) {
        // Use UsageCounter to accumulate LLM usage and cost
        const { usage, cost } = UsageCounter.accumulateLLM({
          cost: state.cost,
          model: llmPayload.model,
          modelUsage: currentStepUsage,
          provider: llmPayload.provider,
          usage: state.usage,
        });

        newState.usage = usage;
        if (cost) newState.cost = cost;
      }

      // If operation was aborted, enter human_abort phase to let agent decide how to handle
      if (finishType === 'abort') {
        log(
          '[%s:%d] call_llm aborted by user, entering human_abort phase',
          state.operationId,
          state.stepCount,
        );

        return {
          events: [],
          newState,
          nextContext: {
            payload: {
              reason: 'user_cancelled',
              parentMessageId: assistantMessageId,
              hasToolsCalling: isFunctionCall,
              toolsCalling: toolCalls,
              result: { content, tool_calls },
            },
            phase: 'human_abort',
            session: {
              messageCount: newState.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      return {
        events: [],
        newState,
        nextContext: {
          payload: {
            hasToolsCalling: isFunctionCall,
            parentMessageId: assistantMessageId,
            result: { content, tool_calls },
            toolsCalling: toolCalls,
          } as GeneralAgentCallLLMResultPayload,
          phase: 'llm_result',
          session: {
            messageCount: newState.messages.length,
            sessionId: state.operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
          stepUsage: currentStepUsage,
        } as AgentRuntimeContext,
      };
    },

    /**
     * Custom call_tool executor
     * Wraps internal_invokeDifferentTypePlugin
     * Follows server-side pattern: always create tool message before execution
     */
    call_tool: async (instruction, state, runtimeContext) => {
      const payload = (instruction as AgentInstructionCallTool)
        .payload as GeneralAgentCallingToolInstructionPayload;

      const events: AgentEvent[] = [];
      const sessionLogId = `${state.operationId}:${state.stepCount}`;

      log('[%s][call_tool] Executor start, payload: %O', sessionLogId, payload);

      // Convert CallingToolPayload to ChatToolPayload for ToolExecutionService
      const chatToolPayload: ChatToolPayload = payload.toolCalling;

      const toolName = `${chatToolPayload.identifier}/${chatToolPayload.apiName}`;
      const startTime = performance.now();

      // Get context from operation
      const opContext = getOperationContext();

      let toolOperationId: string | undefined;
      // ============ Create toolCalling operation (top-level) ============
      const { operationId } = context.get().startOperation({
        type: 'toolCalling',
        context: {
          agentId: opContext.agentId!,
          topicId: opContext.topicId,
          threadId: opContext.threadId,
        },
        parentOperationId: context.operationId,
        metadata: {
          startTime: Date.now(),
          identifier: chatToolPayload.identifier,
          apiName: chatToolPayload.apiName,
          tool_call_id: chatToolPayload.id,
        },
      });
      toolOperationId = operationId;

      try {
        // Get assistant message to extract groupId
        const latestMessages = context.get().dbMessagesMap[context.messageKey] || [];
        // Find the last assistant message (should be created by call_llm)
        const assistantMessage = latestMessages.findLast((m) => m.role === 'assistant');

        let toolMessageId: string;

        if (payload.skipCreateToolMessage) {
          // Reuse existing tool message (resumption mode)
          toolMessageId = payload.parentMessageId;
          // Check if tool message already exists (e.g., from human approval flow)
          const existingToolMessage = latestMessages.find((m) => m.id === toolMessageId)!;

          log(
            '[%s][call_tool] Resuming with existing tool message: %s (status: %s)',
            sessionLogId,
            toolMessageId,
            existingToolMessage.pluginIntervention?.status,
          );
        } else {
          // Create new tool message (normal mode)
          log(
            '[%s][call_tool] Creating tool message for tool_call_id: %s',
            sessionLogId,
            chatToolPayload.id,
          );

          // ============ Sub-operation 1: Create tool message ============
          const createToolMsgOpId = context.get().startOperation({
            type: 'createToolMessage',
            context: {
              agentId: opContext.agentId!,
              topicId: opContext.topicId,
              threadId: opContext.threadId,
            },
            parentOperationId: toolOperationId,
            metadata: {
              startTime: Date.now(),
              tool_call_id: chatToolPayload.id,
            },
          }).operationId;

          // Register cancel handler: Ensure message creation completes, then mark as aborted
          context.get().onOperationCancel(createToolMsgOpId, async ({ metadata }) => {
            log(
              '[%s][call_tool] createToolMessage cancelled, ensuring creation completes',
              sessionLogId,
            );

            // Wait for message creation to complete (ensure-complete strategy)
            const createResult = await metadata?.createMessagePromise;
            if (createResult) {
              const msgId = createResult.id;
              // Update message to aborted state
              await Promise.all([
                context
                  .get()
                  .optimisticUpdateMessageContent(
                    msgId,
                    'Tool execution was cancelled by user.',
                    undefined,
                    { operationId: createToolMsgOpId },
                  ),
                context
                  .get()
                  .optimisticUpdateMessagePlugin(
                    msgId,
                    { intervention: { status: 'aborted' } },
                    { operationId: createToolMsgOpId },
                  ),
              ]);
            }
          });

          // Execute creation and save Promise to metadata
          // Use effective agentId (subAgentId for group orchestration)
          const effectiveAgentId = getEffectiveAgentId();
          const toolMessageParams: CreateMessageParams = {
            content: '',
            groupId: assistantMessage?.groupId,
            parentId: payload.parentMessageId,
            plugin: chatToolPayload,
            role: 'tool',
            agentId: effectiveAgentId!,
            threadId: opContext.threadId,
            tool_call_id: chatToolPayload.id,
            topicId: opContext.topicId ?? undefined,
          };

          const createPromise = context
            .get()
            .optimisticCreateMessage(toolMessageParams, { operationId: createToolMsgOpId });
          context.get().updateOperationMetadata(createToolMsgOpId, {
            createMessagePromise: createPromise,
          });
          const createResult = await createPromise;

          if (!createResult) {
            context.get().failOperation(createToolMsgOpId, {
              type: 'CreateMessageError',
              message: `Failed to create tool message for tool_call_id: ${chatToolPayload.id}`,
            });
            throw new Error(
              `Failed to create tool message for tool_call_id: ${chatToolPayload.id}`,
            );
          }

          toolMessageId = createResult.id;
          log('[%s][call_tool] Created tool message, id: %s', sessionLogId, toolMessageId);
          context.get().completeOperation(createToolMsgOpId);
        }

        // Check if parent operation was cancelled while creating message
        const toolOperation = toolOperationId
          ? context.get().operations[toolOperationId]
          : undefined;
        if (toolOperation?.abortController.signal.aborted) {
          log('[%s][call_tool] Parent operation cancelled, skipping tool execution', sessionLogId);
          // Message already created with aborted status by cancel handler
          return { events, newState: state };
        }

        // ============ Sub-operation 2: Execute tool call ============
        // Auto-associates message with this operation via messageId in context
        const { operationId: executeToolOpId } = context.get().startOperation({
          type: 'executeToolCall',
          context: {
            messageId: toolMessageId,
          },
          parentOperationId: toolOperationId,
          metadata: {
            startTime: Date.now(),
            tool_call_id: chatToolPayload.id,
          },
        });

        log(
          '[%s][call_tool] Created executeToolCall operation %s for message %s',
          sessionLogId,
          executeToolOpId,
          toolMessageId,
        );

        // Register cancel handler: Just update message (message already exists)
        context.get().onOperationCancel(executeToolOpId, async () => {
          log('[%s][call_tool] executeToolCall cancelled, updating message', sessionLogId);

          // Update message to aborted state (cleanup strategy)
          await Promise.all([
            context
              .get()
              .optimisticUpdateMessageContent(
                toolMessageId,
                'Tool execution was cancelled by user.',
                undefined,
                { operationId: executeToolOpId },
              ),
            context
              .get()
              .optimisticUpdateMessagePlugin(
                toolMessageId,
                { intervention: { status: 'aborted' } },
                { operationId: executeToolOpId },
              ),
          ]);
        });

        // Execute tool - abort handling is done by cancel handler
        // Pass stepContext from runtimeContext for dynamic state access
        log(
          '[%s][call_tool] Executing tool %s (hasTodos=%s) ...',
          sessionLogId,
          toolName,
          !!runtimeContext?.stepContext?.todos,
        );
        const result: any = await context
          .get()
          .internal_invokeDifferentTypePlugin(
            toolMessageId,
            chatToolPayload,
            runtimeContext?.stepContext,
          );

        // Check if operation was cancelled during tool execution
        const executeToolOperation = context.get().operations[executeToolOpId];
        if (executeToolOperation?.abortController.signal.aborted) {
          log('[%s][call_tool] Tool execution completed but operation was cancelled', sessionLogId);
          // Don't complete - cancel handler already updated message to aborted
          return { events, newState: state };
        }

        context.get().completeOperation(executeToolOpId);

        const executionTime = Math.round(performance.now() - startTime);
        const isSuccess = result && !result.error;

        log(
          '[%s][call_tool] Executing %s in %dms, result: %O',
          sessionLogId,
          toolName,
          executionTime,
          result,
        );

        // Complete or fail the toolCalling operation
        if (toolOperationId) {
          if (isSuccess) {
            context.get().completeOperation(toolOperationId);
          } else {
            context.get().failOperation(toolOperationId, {
              type: 'ToolExecutionError',
              message: result?.error || 'Tool execution failed',
            });
          }
        }

        events.push({ id: chatToolPayload.id, result, type: 'tool_result' });

        // Get latest messages from store (already updated by internal_invokeDifferentTypePlugin)
        const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];

        const newState = { ...state, messages: updatedMessages };

        // Get tool unit price
        const toolCost = TOOL_PRICING[toolName] || 0;

        // Use UsageCounter to accumulate tool usage
        const { usage, cost } = UsageCounter.accumulateTool({
          cost: state.cost,
          executionTime,
          success: isSuccess,
          toolCost,
          toolName,
          usage: state.usage,
        });

        newState.usage = usage;
        if (cost) newState.cost = cost;

        // Find current tool statistics
        const currentToolStats = usage.tools.byTool.find((t) => t.name === toolName);

        // Log usage
        log(
          '[%s][tool usage] %s: calls=%d, time=%dms, success=%s, cost=$%s',
          sessionLogId,
          toolName,
          currentToolStats?.calls || 0,
          executionTime,
          isSuccess,
          toolCost.toFixed(4),
        );

        // Check if tool wants to stop execution flow
        if (result?.stop) {
          log('[%s][call_tool] Tool returned stop=true, state: %O', sessionLogId, result.state);

          const stateType = result.state?.type;

          // GTD async tasks need to be passed to Agent for exec_task/exec_tasks instruction
          // Includes both server-side (execTask/execTasks) and client-side (execClientTask/execClientTasks)
          const execTaskStateTypes = ['execTask', 'execTasks', 'execClientTask', 'execClientTasks'];
          if (execTaskStateTypes.includes(stateType)) {
            log(
              '[%s][call_tool] Detected %s state, passing to Agent for decision',
              sessionLogId,
              stateType,
            );

            return {
              events,
              newState,
              nextContext: {
                payload: {
                  data: result,
                  executionTime,
                  isSuccess,
                  parentMessageId: toolMessageId,
                  stop: true,
                  toolCall: chatToolPayload,
                  toolCallId: chatToolPayload.id,
                } as GeneralAgentCallToolResultPayload,
                phase: 'tool_result',
                session: {
                  eventCount: events.length,
                  messageCount: newState.messages.length,
                  sessionId: state.operationId,
                  status: 'running',
                  stepCount: state.stepCount + 1,
                },
                stepUsage: {
                  cost: toolCost,
                  toolName,
                  unitPrice: toolCost,
                  usageCount: 1,
                },
              } as AgentRuntimeContext,
            };
          }

          // Other stop types (speak, delegate, broadcast, etc.) - stop execution immediately
          newState.status = 'done';

          return {
            events,
            newState,
            nextContext: undefined,
          };
        }

        log('[%s][call_tool] Tool execution completed', sessionLogId);

        return {
          events,
          newState,
          nextContext: {
            payload: {
              data: result,
              executionTime,
              isSuccess,
              parentMessageId: toolMessageId,
              toolCall: chatToolPayload,
              toolCallId: chatToolPayload.id,
            } as GeneralAgentCallToolResultPayload,
            phase: 'tool_result',
            session: {
              eventCount: events.length,
              messageCount: newState.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
            stepUsage: {
              cost: toolCost,
              toolName,
              unitPrice: toolCost,
              usageCount: 1,
            },
          } as AgentRuntimeContext,
        };
      } catch (error) {
        log('[%s][call_tool] ERROR: Tool execution failed: %O', sessionLogId, error);

        events.push({ error: error, type: 'error' });

        // Return current state on error (no state change)
        return { events, newState: state };
      }
    },

    /** Create human approve executor */
    request_human_approve: async (instruction, state) => {
      const { pendingToolsCalling, reason, skipCreateToolMessage } = instruction as Extract<
        AgentInstruction,
        { type: 'request_human_approve' }
      >;
      const newState = structuredClone(state);
      const events: AgentEvent[] = [];
      const sessionLogId = `${state.operationId}:${state.stepCount}`;

      log(
        '[%s][request_human_approve] Executor start, pending tools count: %d, reason: %s',
        sessionLogId,
        pendingToolsCalling.length,
        reason || 'human_intervention_required',
      );

      // Update state to waiting_for_human
      newState.lastModified = new Date().toISOString();
      newState.status = 'waiting_for_human';
      newState.pendingToolsCalling = pendingToolsCalling;

      // Get assistant message to extract groupId and parentId
      const latestMessages = context.get().dbMessagesMap[context.messageKey] || [];
      const assistantMessage = latestMessages.findLast((m) => m.role === 'assistant');

      if (!assistantMessage) {
        log('[%s][request_human_approve] ERROR: No assistant message found', sessionLogId);
        throw new Error('No assistant message found for intervention');
      }

      log(
        '[%s][request_human_approve] Found assistant message: %s',
        sessionLogId,
        assistantMessage.id,
      );

      if (skipCreateToolMessage) {
        // Resumption mode: Tool messages already exist, just verify them
        log('[%s][request_human_approve] Resuming with existing tool messages', sessionLogId);
      } else {
        // Get context from operation
        const opContext = getOperationContext();
        // Get effective agentId (subAgentId for group orchestration)
        const effectiveAgentId = getEffectiveAgentId();

        // Create tool messages for each pending tool call with intervention status
        await pMap(pendingToolsCalling, async (toolPayload) => {
          const toolName = `${toolPayload.identifier}/${toolPayload.apiName}`;
          log(
            '[%s][request_human_approve] Creating tool message for %s with tool_call_id: %s',
            sessionLogId,
            toolName,
            toolPayload.id,
          );

          const toolMessageParams: CreateMessageParams = {
            content: '',
            groupId: assistantMessage.groupId,
            parentId: assistantMessage.id,
            plugin: {
              ...toolPayload,
            },
            pluginIntervention: { status: 'pending' },
            role: 'tool',
            agentId: effectiveAgentId!,
            threadId: opContext.threadId,
            tool_call_id: toolPayload.id,
            topicId: opContext.topicId ?? undefined,
          };

          const createResult = await context
            .get()
            .optimisticCreateMessage(toolMessageParams, { operationId: context.operationId });

          if (!createResult) {
            log(
              '[%s][request_human_approve] ERROR: Failed to create tool message for %s',
              sessionLogId,
              toolName,
            );
            throw new Error(`Failed to create tool message for ${toolName}`);
          }

          log(
            '[%s][request_human_approve] Created tool message: %s for %s',
            sessionLogId,
            createResult.id,
            toolName,
          );
        });
      }

      log(
        '[%s][request_human_approve] All tool messages created, emitting human_approve_required event',
        sessionLogId,
      );

      events.push({
        operationId: newState.operationId,
        pendingToolsCalling,
        type: 'human_approve_required',
      });

      return { events, newState };
    },

    /**
     * Resolve aborted tools executor
     * Creates tool messages with 'aborted' intervention status for cancelled tools
     */
    resolve_aborted_tools: async (instruction, state) => {
      const { parentMessageId, toolsCalling } = (
        instruction as Extract<AgentInstruction, { type: 'resolve_aborted_tools' }>
      ).payload;

      const events: AgentEvent[] = [];
      const sessionLogId = `${state.operationId}:${state.stepCount}`;
      const newState = structuredClone(state);

      log(
        '[%s][resolve_aborted_tools] Resolving %d aborted tools',
        sessionLogId,
        toolsCalling.length,
      );

      // Get context from operation
      const opContext = getOperationContext();
      // Get effective agentId (subAgentId for group orchestration)
      const effectiveAgentId = getEffectiveAgentId();

      // Create tool messages for each aborted tool
      await pMap(toolsCalling, async (toolPayload) => {
        const toolName = `${toolPayload.identifier}/${toolPayload.apiName}`;
        log(
          '[%s][resolve_aborted_tools] Creating aborted tool message for %s',
          sessionLogId,
          toolName,
        );

        const toolMessageParams: CreateMessageParams = {
          content: 'Tool execution was aborted by user.',
          groupId: opContext.groupId,
          parentId: parentMessageId,
          plugin: toolPayload,
          pluginIntervention: { status: 'aborted' },
          role: 'tool',
          agentId: effectiveAgentId!,
          threadId: opContext.threadId,
          tool_call_id: toolPayload.id,
          topicId: opContext.topicId ?? undefined,
        };

        const createResult = await context
          .get()
          .optimisticCreateMessage(toolMessageParams, { operationId: context.operationId });

        if (createResult) {
          log(
            '[%s][resolve_aborted_tools] Created aborted tool message: %s for %s',
            sessionLogId,
            createResult.id,
            toolName,
          );
        }
      });

      log('[%s][resolve_aborted_tools] All aborted tool messages created', sessionLogId);

      // Mark state as done since we're finishing after abort
      newState.lastModified = new Date().toISOString();
      newState.status = 'done';

      events.push({
        finalState: newState,
        reason: 'user_aborted',
        reasonDetail: 'User aborted operation with pending tool calls',
        type: 'done',
      });

      return { events, newState };
    },

    /**
     * Finish executor
     * Completes the runtime execution
     */
    finish: async (instruction, state) => {
      const { reason, reasonDetail } = instruction as Extract<AgentInstruction, { type: 'finish' }>;
      const sessionLogId = `${state.operationId}:${state.stepCount}`;

      log(`[${sessionLogId}] Finishing execution: (%s)`, reason);

      const newState = structuredClone(state);
      newState.lastModified = new Date().toISOString();
      newState.status = 'done';

      const events: AgentEvent[] = [{ finalState: newState, reason, reasonDetail, type: 'done' }];

      return { events, newState };
    },

    /**
     * exec_task executor
     * Executes a single async task
     *
     * Flow:
     * 1. Create a task message (role: 'task') as placeholder
     * 2. Call execSubAgentTask API (backend creates thread)
     * 3. Poll for task completion
     * 4. Update task message content with result on completion
     * 5. Return task_result phase with result
     */
    exec_task: async (instruction, state) => {
      const { parentMessageId, task } = (instruction as AgentInstructionExecTask).payload;

      const events: AgentEvent[] = [];
      const sessionLogId = `${state.operationId}:${state.stepCount}`;

      log('[%s][exec_task] Starting execution of task: %s', sessionLogId, task.description);

      // Get context from operation
      const opContext = getOperationContext();
      const { agentId, topicId } = opContext;

      if (!agentId || !topicId) {
        log('[%s][exec_task] No valid context, cannot execute task', sessionLogId);
        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              parentMessageId,
              result: {
                error: 'No valid context available',
                success: false,
                taskMessageId: '',
                threadId: '',
              },
            } as TaskResultPayload,
            phase: 'task_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      const taskLogId = `${sessionLogId}:task`;

      try {
        // 1. Create task message as placeholder
        const taskMessageResult = await context.get().optimisticCreateMessage(
          {
            agentId,
            content: '',
            metadata: { instruction: task.instruction, taskTitle: task.description },
            parentId: parentMessageId,
            role: 'task',
            topicId,
          },
          { operationId: state.operationId },
        );

        if (!taskMessageResult) {
          log('[%s] Failed to create task message', taskLogId);
          return {
            events,
            newState: state,
            nextContext: {
              payload: {
                parentMessageId,
                result: {
                  error: 'Failed to create task message',
                  success: false,
                  taskMessageId: '',
                  threadId: '',
                },
              } as TaskResultPayload,
              phase: 'task_result',
              session: {
                messageCount: state.messages.length,
                sessionId: state.operationId,
                status: 'running',
                stepCount: state.stepCount + 1,
              },
            } as AgentRuntimeContext,
          };
        }

        const taskMessageId = taskMessageResult.id;
        log('[%s] Created task message: %s', taskLogId, taskMessageId);

        // 2. Create and execute task on server
        log('[%s] Using server-side execution', taskLogId);
        const createResult = await aiAgentService.execSubAgentTask({
          agentId,
          instruction: task.instruction,
          parentMessageId: taskMessageId,
          title: task.description,
          topicId,
        });

        if (!createResult.success) {
          log('[%s] Failed to create task: %s', taskLogId, createResult.error);
          await context
            .get()
            .optimisticUpdateMessageContent(
              taskMessageId,
              `Task creation failed: ${createResult.error}`,
              undefined,
              { operationId: state.operationId },
            );
          return {
            events,
            newState: state,
            nextContext: {
              payload: {
                parentMessageId,
                result: {
                  error: createResult.error,
                  success: false,
                  taskMessageId,
                  threadId: '',
                },
              } as TaskResultPayload,
              phase: 'task_result',
              session: {
                messageCount: state.messages.length,
                sessionId: state.operationId,
                status: 'running',
                stepCount: state.stepCount + 1,
              },
            } as AgentRuntimeContext,
          };
        }

        log('[%s] Task created with threadId: %s', taskLogId, createResult.threadId);

        // 3. Poll for task completion
        const pollInterval = 3000; // 3 seconds
        const maxWait = task.timeout || 1_800_000; // Default 30 minutes
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          // Check if parent operation has been cancelled
          const currentOperation = context.get().operations[state.operationId];
          if (currentOperation?.status === 'cancelled') {
            log('[%s] Operation cancelled, stopping polling', taskLogId);

            // Send interrupt request to stop the server-side task
            try {
              await aiAgentService.interruptTask({ threadId: createResult.threadId });
              log('[%s] Sent interrupt request for cancelled task', taskLogId);
            } catch (err) {
              log('[%s] Failed to interrupt cancelled task: %O', taskLogId, err);
            }

            // Update task message to cancelled state
            await context
              .get()
              .optimisticUpdateMessageContent(
                taskMessageId,
                'Task was cancelled by user.',
                undefined,
                { operationId: state.operationId },
              );

            const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
            return {
              events,
              newState: { ...state, messages: updatedMessages },
              nextContext: {
                payload: {
                  parentMessageId,
                  result: {
                    error: 'Operation cancelled',
                    success: false,
                    taskMessageId,
                    threadId: createResult.threadId,
                  },
                } as TaskResultPayload,
                phase: 'task_result',
                session: {
                  messageCount: updatedMessages.length,
                  sessionId: state.operationId,
                  status: 'running',
                  stepCount: state.stepCount + 1,
                },
              } as AgentRuntimeContext,
            };
          }

          const status = await aiAgentService.getSubAgentTaskStatus({
            threadId: createResult.threadId,
          });

          // Update taskDetail in message if available
          if (status.taskDetail) {
            context.get().internal_dispatchMessage(
              {
                id: taskMessageId,
                type: 'updateMessage',
                value: { taskDetail: status.taskDetail },
              },
              { operationId: state.operationId },
            );
            log('[%s] Updated task message with taskDetail', taskLogId);
          }

          if (status.status === 'completed') {
            log('[%s] Task completed successfully', taskLogId);
            if (status.result) {
              await context
                .get()
                .optimisticUpdateMessageContent(taskMessageId, status.result, undefined, {
                  operationId: state.operationId,
                });
            }
            const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
            return {
              events,
              newState: { ...state, messages: updatedMessages },
              nextContext: {
                payload: {
                  parentMessageId,
                  result: {
                    result: status.result,
                    success: true,
                    taskMessageId,
                    threadId: createResult.threadId,
                  },
                } as TaskResultPayload,
                phase: 'task_result',
                session: {
                  messageCount: updatedMessages.length,
                  sessionId: state.operationId,
                  status: 'running',
                  stepCount: state.stepCount + 1,
                },
              } as AgentRuntimeContext,
            };
          }

          if (status.status === 'failed') {
            // Extract error message (error is always a string in TaskStatusResult)
            const errorMessage = status.error || 'Unknown error';
            log('[%s] Task failed: %s', taskLogId, errorMessage);
            await context
              .get()
              .optimisticUpdateMessageContent(
                taskMessageId,
                `Task failed: ${errorMessage}`,
                undefined,
                { operationId: state.operationId },
              );
            const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
            return {
              events,
              newState: { ...state, messages: updatedMessages },
              nextContext: {
                payload: {
                  parentMessageId,
                  result: {
                    error: status.error,
                    success: false,
                    taskMessageId,
                    threadId: createResult.threadId,
                  },
                } as TaskResultPayload,
                phase: 'task_result',
                session: {
                  messageCount: updatedMessages.length,
                  sessionId: state.operationId,
                  status: 'running',
                  stepCount: state.stepCount + 1,
                },
              } as AgentRuntimeContext,
            };
          }

          if (status.status === 'cancel') {
            log('[%s] Task was cancelled', taskLogId);
            // Note: Don't fail the operation here - it was cancelled intentionally
            // The cancel handler already updated the message
            await context
              .get()
              .optimisticUpdateMessageContent(taskMessageId, 'Task was cancelled', undefined, {
                operationId: state.operationId,
              });
            const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
            return {
              events,
              newState: { ...state, messages: updatedMessages },
              nextContext: {
                payload: {
                  parentMessageId,
                  result: {
                    error: 'Task was cancelled',
                    success: false,
                    taskMessageId,
                    threadId: createResult.threadId,
                  },
                } as TaskResultPayload,
                phase: 'task_result',
                session: {
                  messageCount: updatedMessages.length,
                  sessionId: state.operationId,
                  status: 'running',
                  stepCount: state.stepCount + 1,
                },
              } as AgentRuntimeContext,
            };
          }

          // Still processing, wait and poll again
          await sleep(pollInterval);
        }

        // Timeout reached
        log('[%s] Task timeout after %dms', taskLogId, maxWait);

        // Try to interrupt the task that timed out
        try {
          await aiAgentService.interruptTask({ threadId: createResult.threadId });
          log('[%s] Sent interrupt request for timed out task', taskLogId);
        } catch (err) {
          log('[%s] Failed to interrupt timed out task: %O', taskLogId, err);
        }

        await context
          .get()
          .optimisticUpdateMessageContent(
            taskMessageId,
            `Task timeout after ${maxWait}ms`,
            undefined,
            { operationId: state.operationId },
          );

        const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
        return {
          events,
          newState: { ...state, messages: updatedMessages },
          nextContext: {
            payload: {
              parentMessageId,
              result: {
                error: `Task timeout after ${maxWait}ms`,
                success: false,
                taskMessageId,
                threadId: createResult.threadId,
              },
            } as TaskResultPayload,
            phase: 'task_result',
            session: {
              messageCount: updatedMessages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      } catch (error) {
        log('[%s] Error executing task: %O', taskLogId, error);
        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              parentMessageId,
              result: {
                error: error instanceof Error ? error.message : 'Unknown error',
                success: false,
                taskMessageId: '',
                threadId: '',
              },
            } as TaskResultPayload,
            phase: 'task_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }
    },

    /**
     * exec_tasks executor
     * Executes one or more async tasks in parallel
     *
     * Flow:
     * 1. For each task, create a task message (role: 'task') as placeholder
     * 2. Call execSubAgentTask API (backend creates thread)
     * 3. Poll for task completion
     * 4. Update task message content with result on completion
     * 5. Return tasks_batch_result phase with all results
     */
    exec_tasks: async (instruction, state) => {
      const { parentMessageId, tasks } = (instruction as AgentInstructionExecTasks).payload;

      const events: AgentEvent[] = [];
      const sessionLogId = `${state.operationId}:${state.stepCount}`;

      log('[%s][exec_tasks] Starting execution of %d tasks', sessionLogId, tasks.length);

      // Get context from operation
      const opContext = getOperationContext();
      const { agentId, topicId } = opContext;

      if (!agentId || !topicId) {
        log('[%s][exec_tasks] No valid context, cannot execute tasks', sessionLogId);
        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              parentMessageId,
              results: tasks.map(() => ({
                error: 'No valid context available',
                success: false,
                taskMessageId: '',
                threadId: '',
              })),
            } as TasksBatchResultPayload,
            phase: 'tasks_batch_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      // Execute all tasks in parallel
      const results = await pMap(
        tasks,
        async (task, taskIndex) => {
          const taskLogId = `${sessionLogId}:task-${taskIndex}`;
          log('[%s] Starting task: %s', taskLogId, task.description);

          try {
            // 1. Create task message as placeholder
            const taskMessageResult = await context.get().optimisticCreateMessage(
              {
                agentId,
                content: '',
                createdAt: Date.now() + taskIndex,
                metadata: { instruction: task.instruction },
                parentId: parentMessageId,
                role: 'task',
                topicId,
              },
              { operationId: state.operationId },
            );

            if (!taskMessageResult) {
              log('[%s] Failed to create task message', taskLogId);
              return {
                error: 'Failed to create task message',
                success: false,
                taskMessageId: '',
                threadId: '',
              };
            }

            const taskMessageId = taskMessageResult.id;
            log('[%s] Created task message: %s', taskLogId, taskMessageId);

            // 2. Create and execute task on server
            log('[%s] Using server-side execution', taskLogId);
            const createResult = await aiAgentService.execSubAgentTask({
              agentId,
              instruction: task.instruction,
              parentMessageId: taskMessageId,
              title: task.description,
              topicId,
            });

            if (!createResult.success) {
              log('[%s] Failed to create task: %s', taskLogId, createResult.error);
              // Update task message with error
              await context
                .get()
                .optimisticUpdateMessageContent(
                  taskMessageId,
                  `Task creation failed: ${createResult.error}`,
                  undefined,
                  { operationId: state.operationId },
                );
              return {
                error: createResult.error,
                success: false,
                taskMessageId,
                threadId: '',
              };
            }

            log('[%s] Task created with threadId: %s', taskLogId, createResult.threadId);

            // 4. Poll for task completion
            const pollInterval = 3000; // 3 seconds
            const maxWait = task.timeout || 1_800_000; // Default 30 minutes
            const startTime = Date.now();

            while (Date.now() - startTime < maxWait) {
              // Check if parent operation has been cancelled
              const currentOperation = context.get().operations[state.operationId];
              if (currentOperation?.status === 'cancelled') {
                log('[%s] Operation cancelled, stopping polling', taskLogId);

                // Send interrupt request to stop the server-side task
                try {
                  await aiAgentService.interruptTask({ threadId: createResult.threadId });
                  log('[%s] Sent interrupt request for cancelled task', taskLogId);
                } catch (err) {
                  log('[%s] Failed to interrupt cancelled task: %O', taskLogId, err);
                }

                // Update task message to cancelled state
                await context
                  .get()
                  .optimisticUpdateMessageContent(
                    taskMessageId,
                    'Task was cancelled by user.',
                    undefined,
                    { operationId: state.operationId },
                  );

                return {
                  error: 'Operation cancelled',
                  success: false,
                  taskMessageId,
                  threadId: createResult.threadId,
                };
              }

              const status = await aiAgentService.getSubAgentTaskStatus({
                threadId: createResult.threadId,
              });

              // Update taskDetail in message if available
              if (status.taskDetail) {
                context.get().internal_dispatchMessage(
                  {
                    id: taskMessageId,
                    type: 'updateMessage',
                    value: { taskDetail: status.taskDetail },
                  },
                  { operationId: state.operationId },
                );
                log('[%s] Updated task message with taskDetail', taskLogId);
              }

              if (status.status === 'completed') {
                log('[%s] Task completed successfully', taskLogId);
                // 5. Update task message with result
                if (status.result) {
                  await context
                    .get()
                    .optimisticUpdateMessageContent(taskMessageId, status.result, undefined, {
                      operationId: state.operationId,
                    });
                }
                return {
                  result: status.result,
                  success: true,
                  taskMessageId,
                  threadId: createResult.threadId,
                };
              }

              if (status.status === 'failed') {
                const errorMessage = status.error || 'Unknown error';
                log('[%s] Task failed: %s', taskLogId, errorMessage);
                // Update task message with error
                await context
                  .get()
                  .optimisticUpdateMessageContent(
                    taskMessageId,
                    `Task failed: ${errorMessage}`,
                    undefined,
                    { operationId: state.operationId },
                  );
                return {
                  error: status.error,
                  success: false,
                  taskMessageId,
                  threadId: createResult.threadId,
                };
              }

              if (status.status === 'cancel') {
                log('[%s] Task was cancelled', taskLogId);
                // Note: Don't fail the operation here - it was cancelled intentionally
                // The cancel handler already updated the message
                await context
                  .get()
                  .optimisticUpdateMessageContent(taskMessageId, 'Task was cancelled', undefined, {
                    operationId: state.operationId,
                  });
                return {
                  error: 'Task was cancelled',
                  success: false,
                  taskMessageId,
                  threadId: createResult.threadId,
                };
              }

              // Still processing, wait and poll again
              await sleep(pollInterval);
            }

            // Timeout reached
            log('[%s] Task timeout after %dms', taskLogId, maxWait);

            // Try to interrupt the task that timed out
            try {
              await aiAgentService.interruptTask({ threadId: createResult.threadId });
              log('[%s] Sent interrupt request for timed out task', taskLogId);
            } catch (err) {
              log('[%s] Failed to interrupt timed out task: %O', taskLogId, err);
            }

            // Update task message with timeout error
            await context
              .get()
              .optimisticUpdateMessageContent(
                taskMessageId,
                `Task timeout after ${maxWait}ms`,
                undefined,
                { operationId: state.operationId },
              );

            return {
              error: `Task timeout after ${maxWait}ms`,
              success: false,
              taskMessageId,
              threadId: createResult.threadId,
            };
          } catch (error) {
            log('[%s] Error executing task: %O', taskLogId, error);
            return {
              error: error instanceof Error ? error.message : 'Unknown error',
              success: false,
              taskMessageId: '',
              threadId: '',
            };
          }
        },
        { concurrency: 15 }, // Limit concurrent tasks
      );

      log('[%s][exec_tasks] All tasks completed, results: %O', sessionLogId, results);

      // Get latest messages from store
      const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
      const newState = { ...state, messages: updatedMessages };

      // Return tasks_batch_result phase
      return {
        events,
        newState,
        nextContext: {
          payload: {
            parentMessageId,
            results,
          } as TasksBatchResultPayload,
          phase: 'tasks_batch_result',
          session: {
            messageCount: newState.messages.length,
            sessionId: state.operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        } as AgentRuntimeContext,
      };
    },

    /**
     * exec_client_task executor
     * Executes a single async task on the client side (desktop only)
     * Used when task requires local tools like file system or shell commands
     *
     * Flow:
     * 1. Create a task message (role: 'task') as placeholder
     * 2. Create Thread via API (for isolation)
     * 3. Execute using internal_execAgentRuntime (client-side)
     * 4. Update Thread status via API on completion
     * 5. Update task message content with result
     * 6. Return task_result phase with result
     */
    exec_client_task: async (instruction, state) => {
      const { parentMessageId, task } = (instruction as AgentInstructionExecClientTask).payload;

      const events: AgentEvent[] = [];
      const sessionLogId = `${state.operationId}:${state.stepCount}`;

      log(
        '[%s][exec_client_task] Starting client-side execution of task: %s',
        sessionLogId,
        task.description,
      );

      // Check if we're on desktop - if not, this executor shouldn't have been called
      if (!isDesktop) {
        log(
          '[%s][exec_client_task] ERROR: Not on desktop, cannot execute client-side task',
          sessionLogId,
        );
        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              parentMessageId,
              result: {
                error: 'Client-side task execution is only available on desktop',
                success: false,
                taskMessageId: '',
                threadId: '',
              },
            } as TaskResultPayload,
            phase: 'task_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      // Get context from operation
      const opContext = getOperationContext();
      const { agentId, topicId } = opContext;

      if (!agentId || !topicId) {
        log('[%s][exec_client_task] No valid context, cannot execute task', sessionLogId);
        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              parentMessageId,
              result: {
                error: 'No valid context available',
                success: false,
                taskMessageId: '',
                threadId: '',
              },
            } as TaskResultPayload,
            phase: 'task_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      const taskLogId = `${sessionLogId}:client-task`;

      // Get agent's model and provider configuration
      const agentState = getAgentStoreState();
      const taskModel = agentByIdSelectors.getAgentModelById(agentId)(agentState);
      const taskProvider = agentByIdSelectors.getAgentModelProviderById(agentId)(agentState);

      try {
        // 1. Create task message as placeholder with model/provider
        const taskMessageResult = await context.get().optimisticCreateMessage(
          {
            agentId,
            content: '',
            metadata: { instruction: task.instruction, taskTitle: task.description },
            model: taskModel,
            parentId: parentMessageId,
            provider: taskProvider,
            role: 'task',
            topicId,
          },
          { operationId: state.operationId },
        );

        if (!taskMessageResult) {
          log('[%s] Failed to create task message', taskLogId);
          return {
            events,
            newState: state,
            nextContext: {
              payload: {
                parentMessageId,
                result: {
                  error: 'Failed to create task message',
                  success: false,
                  taskMessageId: '',
                  threadId: '',
                },
              } as TaskResultPayload,
              phase: 'task_result',
              session: {
                messageCount: state.messages.length,
                sessionId: state.operationId,
                status: 'running',
                stepCount: state.stepCount + 1,
              },
            } as AgentRuntimeContext,
          };
        }

        const taskMessageId = taskMessageResult.id;
        log('[%s][exec_client_task] Created task message: %s', taskLogId, taskMessageId);

        // 2. Create Thread via API first (to get threadId for operation context)
        const threadResult = await aiAgentService.createClientTaskThread({
          agentId,
          instruction: task.instruction,
          parentMessageId: taskMessageId,
          title: task.description,
          topicId,
        });

        if (!threadResult.success) {
          log('[%s][exec_client_task] Failed to create client task thread', taskLogId);
          await context
            .get()
            .optimisticUpdateMessageContent(
              taskMessageId,
              'Failed to create task thread',
              undefined,
              { operationId: state.operationId },
            );
          return {
            events,
            newState: state,
            nextContext: {
              payload: {
                parentMessageId,
                result: {
                  error: 'Failed to create client task thread',
                  success: false,
                  taskMessageId,
                  threadId: '',
                },
              } as TaskResultPayload,
              phase: 'task_result',
              session: {
                messageCount: state.messages.length,
                sessionId: state.operationId,
                status: 'running',
                stepCount: state.stepCount + 1,
              },
            } as AgentRuntimeContext,
          };
        }

        const { threadId, userMessageId, threadMessages, messages } = threadResult;

        // 3. Build sub-task ConversationContext (uses threadId for isolation)
        const subContext: ConversationContext = {
          agentId,
          topicId,
          threadId,
          scope: 'thread',
        };

        // 4. Create a child operation for task execution (now with threadId)
        const { operationId: taskOperationId } = context.get().startOperation({
          type: 'execClientTask',
          context: subContext,
          parentOperationId: state.operationId,
          metadata: {
            startTime: Date.now(),
            taskDescription: task.description,
            taskMessageId,
            executionMode: 'client',
          },
        });
        log(
          '[%s][exec_client_task] Created thread: %s, userMessageId: %s, threadMessages: %d',
          taskLogId,
          threadId,
          userMessageId,
          threadMessages.length,
        );

        // 5. Sync messages to store
        // Update main chat messages with latest taskDetail status
        context.get().replaceMessages(messages, { operationId: state.operationId });
        // Update thread messages
        context.get().replaceMessages(threadMessages, { context: subContext });

        // 6. Use server-returned thread messages (already persisted)
        let subMessages = [...threadMessages];

        // Optionally inherit messages from parent conversation
        if (task.inheritMessages) {
          const parentMessages = state.messages.filter((m) => m.role !== 'task');
          subMessages = [...parentMessages, ...subMessages];
          // Re-sync with inherited messages
          context.get().replaceMessages(subMessages, { context: subContext });
        }

        // 7. Execute using internal_execAgentRuntime (client-side with local tools access)
        log('[%s][exec_client_task] Starting client-side AgentRuntime execution', taskLogId);

        const runtimeResult = await context.get().internal_execAgentRuntime({
          context: subContext,
          messages: subMessages,
          parentMessageId: userMessageId, // Use server-returned userMessageId
          parentMessageType: 'user',
          operationId: taskOperationId,
          parentOperationId: state.operationId,
          isSubTask: true, // Disable lobe-gtd tools to prevent nested sub-tasks
        });

        log('[%s][exec_client_task] Client-side AgentRuntime execution completed', taskLogId);

        // 8. Get execution result from sub-task messages
        const subMessageKey = messageMapKey(subContext);
        const subTaskMessages = context.get().dbMessagesMap[subMessageKey] || [];
        const lastAssistant = subTaskMessages.findLast((m) => m.role === 'assistant');
        const resultContent = lastAssistant?.content || 'Task completed';

        log(
          '[%s][exec_client_task] Got result from sub-task: %d chars',
          taskLogId,
          resultContent.length,
        );

        // Count tool calls
        const totalToolCalls = subTaskMessages.filter((m) => m.role === 'tool').length;

        // Get usage data from runtime result
        const { usage, cost } = runtimeResult || {};

        log(
          '[%s][exec_client_task] Runtime usage: tokens=%d, cost=%s, model=%s',
          taskLogId,
          usage?.llm?.tokens?.total,
          cost?.total,
          taskModel,
        );

        // 9. Update task message with result and usage (model/provider already set at creation)
        await context.get().optimisticUpdateMessageContent(
          taskMessageId,
          resultContent,
          {
            metadata: {
              cost: cost?.total,
              duration: usage?.llm?.processingTimeMs,
              totalInputTokens: usage?.llm?.tokens?.input,
              totalOutputTokens: usage?.llm?.tokens?.output,
              totalTokens: usage?.llm?.tokens?.total,
            },
          },
          { operationId: state.operationId },
        );

        // 10. Update Thread status via API with metadata
        await aiAgentService.updateClientTaskThreadStatus({
          threadId,
          completionReason: 'done',
          resultContent,
          metadata: {
            totalCost: cost?.total,
            totalMessages: subTaskMessages.length,
            totalTokens: usage?.llm?.tokens?.total,
            totalToolCalls,
          },
        });

        // 11. Complete operation
        context.get().completeOperation(taskOperationId);

        // 12. Return success result
        const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
        return {
          events,
          newState: { ...state, messages: updatedMessages },
          nextContext: {
            payload: {
              // Use taskMessageId as parent so subsequent messages are created after the task
              parentMessageId: taskMessageId,
              result: {
                result: resultContent,
                success: true,
                taskMessageId,
                threadId,
              },
            } as TaskResultPayload,
            phase: 'task_result',
            session: {
              messageCount: updatedMessages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      } catch (error) {
        log('[%s][exec_client_task] Error executing client task: %O', taskLogId, error);

        // Update task message with error
        // Note: taskMessageId may not exist if error occurred before message creation
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              parentMessageId,
              result: {
                error: errorMessage,
                success: false,
                taskMessageId: '',
                threadId: '',
              },
            } as TaskResultPayload,
            phase: 'task_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }
    },

    /**
     * exec_client_tasks executor
     * Executes multiple async tasks on the client side in parallel (desktop only)
     * Used when tasks require local tools like file system or shell commands
     *
     * Flow:
     * 1. For each task, create a task message (role: 'task') as placeholder
     * 2. Create Thread via API (for isolation)
     * 3. Execute using internal_execAgentRuntime (client-side)
     * 4. Update Thread status via API on completion
     * 5. Update task message content with result
     * 6. Return tasks_batch_result phase with all results
     */
    exec_client_tasks: async (instruction, state) => {
      const { parentMessageId, tasks } = (instruction as AgentInstructionExecClientTasks).payload;

      const events: AgentEvent[] = [];
      const sessionLogId = `${state.operationId}:${state.stepCount}`;

      log(
        '[%s][exec_client_tasks] Starting client-side execution of %d tasks',
        sessionLogId,
        tasks.length,
      );

      // Check if we're on desktop - if not, this executor shouldn't have been called
      if (!isDesktop) {
        log(
          '[%s][exec_client_tasks] ERROR: Not on desktop, cannot execute client-side tasks',
          sessionLogId,
        );
        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              parentMessageId,
              results: tasks.map(() => ({
                error: 'Client-side task execution is only available on desktop',
                success: false,
                taskMessageId: '',
                threadId: '',
              })),
            } as TasksBatchResultPayload,
            phase: 'tasks_batch_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      // Get context from operation
      const opContext = getOperationContext();
      const { agentId, topicId } = opContext;

      if (!agentId || !topicId) {
        log('[%s][exec_client_tasks] No valid context, cannot execute tasks', sessionLogId);
        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              parentMessageId,
              results: tasks.map(() => ({
                error: 'No valid context available',
                success: false,
                taskMessageId: '',
                threadId: '',
              })),
            } as TasksBatchResultPayload,
            phase: 'tasks_batch_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      // Execute all tasks in parallel
      const results = await pMap(
        tasks,
        async (task, taskIndex) => {
          const taskLogId = `${sessionLogId}:client-task-${taskIndex}`;
          log('[%s] Starting client task: %s', taskLogId, task.description);

          try {
            // 1. Create task message as placeholder
            const taskMessageResult = await context.get().optimisticCreateMessage(
              {
                agentId,
                content: '',
                createdAt: Date.now() + taskIndex,
                metadata: { instruction: task.instruction, taskTitle: task.description },
                parentId: parentMessageId,
                role: 'task',
                topicId,
              },
              { operationId: state.operationId },
            );

            if (!taskMessageResult) {
              log('[%s] Failed to create task message', taskLogId);
              return {
                error: 'Failed to create task message',
                success: false,
                taskMessageId: '',
                threadId: '',
              };
            }

            const taskMessageId = taskMessageResult.id;
            log('[%s] Created task message: %s', taskLogId, taskMessageId);

            // 2. Create Thread via API first (to get threadId for operation context)
            const threadResult = await aiAgentService.createClientTaskThread({
              agentId,
              instruction: task.instruction,
              parentMessageId: taskMessageId,
              title: task.description,
              topicId,
            });

            if (!threadResult.success) {
              log('[%s] Failed to create client task thread', taskLogId);
              await context
                .get()
                .optimisticUpdateMessageContent(
                  taskMessageId,
                  'Failed to create task thread',
                  undefined,
                  { operationId: state.operationId },
                );
              return {
                error: 'Failed to create client task thread',
                success: false,
                taskMessageId,
                threadId: '',
              };
            }

            const { threadId, userMessageId, threadMessages, messages } = threadResult;
            log(
              '[%s] Created thread: %s, userMessageId: %s, threadMessages: %d',
              taskLogId,
              threadId,
              userMessageId,
              threadMessages.length,
            );

            // 3. Build sub-task ConversationContext (uses threadId for isolation)
            const subContext: ConversationContext = {
              agentId,
              topicId,
              threadId,
              scope: 'thread',
            };

            // 4. Create a child operation for task execution (now with threadId)
            const { operationId: taskOperationId } = context.get().startOperation({
              type: 'execClientTask',
              context: subContext,
              parentOperationId: state.operationId,
              metadata: {
                startTime: Date.now(),
                taskDescription: task.description,
                taskIndex,
                taskMessageId,
                executionMode: 'client',
              },
            });

            // 5. Sync messages to store
            // Update main chat messages with latest taskDetail status
            context.get().replaceMessages(messages, { operationId: state.operationId });
            // Update thread messages
            context.get().replaceMessages(threadMessages, { context: subContext });

            // 6. Use server-returned thread messages (already persisted)
            let subMessages = [...threadMessages];

            // Optionally inherit messages from parent conversation
            if (task.inheritMessages) {
              const parentMessages = state.messages.filter((m) => m.role !== 'task');
              subMessages = [...parentMessages, ...subMessages];
              // Re-sync with inherited messages
              context.get().replaceMessages(subMessages, { context: subContext });
            }

            // 7. Execute using internal_execAgentRuntime (client-side with local tools access)
            log('[%s] Starting client-side AgentRuntime execution', taskLogId);

            await context.get().internal_execAgentRuntime({
              context: subContext,
              messages: subMessages,
              parentMessageId: userMessageId, // Use server-returned userMessageId
              parentMessageType: 'user',
              operationId: taskOperationId,
              parentOperationId: state.operationId,
              isSubTask: true, // Disable lobe-gtd tools to prevent nested sub-tasks
            });

            log('[%s] Client-side AgentRuntime execution completed', taskLogId);

            // 7. Get execution result from sub-task messages
            const subMessageKey = messageMapKey(subContext);
            const subTaskMessages = context.get().dbMessagesMap[subMessageKey] || [];
            const lastAssistant = subTaskMessages.findLast((m) => m.role === 'assistant');
            const resultContent = lastAssistant?.content || 'Task completed';

            log('[%s] Got result from sub-task: %d chars', taskLogId, resultContent.length);

            // 8. Update task message with result
            await context
              .get()
              .optimisticUpdateMessageContent(taskMessageId, resultContent, undefined, {
                operationId: state.operationId,
              });

            // 9. Update Thread status via API
            await aiAgentService.updateClientTaskThreadStatus({
              threadId,
              completionReason: 'done',
              resultContent,
            });

            // 10. Complete operation
            context.get().completeOperation(taskOperationId);

            return {
              result: resultContent,
              success: true,
              taskMessageId,
              threadId,
            };
          } catch (error) {
            log('[%s] Error executing client task: %O', taskLogId, error);
            return {
              error: error instanceof Error ? error.message : 'Unknown error',
              success: false,
              taskMessageId: '',
              threadId: '',
            };
          }
        },
        { concurrency: 15 },
      );

      log('[%s][exec_client_tasks] All tasks completed, results: %O', sessionLogId, results);

      // Get latest messages from store
      const updatedMessages = context.get().dbMessagesMap[context.messageKey] || [];
      const newState = { ...state, messages: updatedMessages };

      // Use the last successful task's message ID as parent for subsequent messages
      const lastSuccessfulTaskId = results.findLast((r) => r.success)?.taskMessageId;

      return {
        events,
        newState,
        nextContext: {
          payload: {
            // Use last task message as parent so subsequent messages are created after the tasks
            parentMessageId: lastSuccessfulTaskId || parentMessageId,
            results,
          } as TasksBatchResultPayload,
          phase: 'tasks_batch_result',
          session: {
            messageCount: newState.messages.length,
            sessionId: state.operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
        } as AgentRuntimeContext,
      };
    },

    /**
     * Context compression executor
     * Compresses ALL messages into a single MessageGroup summary to reduce token usage
     */
    compress_context: async (instruction, state) => {
      const sessionLogId = `${state.operationId}:${state.stepCount}`;
      const stagePrefix = `[${sessionLogId}][compress_context]`;

      const { messages, currentTokenCount } = (instruction as AgentInstructionCompressContext)
        .payload;

      // Get topicId from operation context (same as agentId)
      const { topicId } = getOperationContext();

      log(
        `${stagePrefix} Starting compression. displayMessages=%d, tokens=%d`,
        messages.length,
        currentTokenCount,
      );

      const events: AgentEvent[] = [];

      // Get message IDs from dbMessagesMap (raw db messages)
      const dbMessages = context.get().dbMessagesMap[context.messageKey] || [];
      const messageIds = dbMessages.map((m) => m.id).filter(Boolean);

      if (!topicId || messageIds.length === 0) {
        // No topicId or no messages, skip compression
        log(
          `${stagePrefix} Skipping compression: topicId=%s, messageIds=%d`,
          topicId,
          messageIds.length,
        );
        return {
          events: [],
          newState: state,
          nextContext: {
            payload: {
              compressedMessages: messages,
              compressedTokenCount: currentTokenCount,
              groupId: '',
              originalTokenCount: currentTokenCount,
              skipped: true,
            } as GeneralAgentCompressionResultPayload,
            phase: 'compression_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }

      // Find the latest assistant message to attach the compression operation
      const latestAssistantMessage = dbMessages.findLast((m) => m.role === 'assistant');
      const assistantMessageId = latestAssistantMessage?.id;

      log(
        `${stagePrefix} Compressing %d db messages (display: %d), assistantMsgId=%s`,
        messageIds.length,
        messages.length,
        assistantMessageId,
      );

      // Create compress_context operation and attach to the assistant message
      const { operationId: compressOperationId } = context.get().startOperation({
        context: { ...getOperationContext(), messageId: assistantMessageId },
        metadata: {
          messageCount: messageIds.length,
          startTime: Date.now(),
        },
        parentOperationId: state.operationId,
        type: 'contextCompression',
      });

      try {
        const opContext = getOperationContext();
        // agentId is guaranteed to exist in compression context
        const agentId = getEffectiveAgentId()!;

        // 1. Create compression group with placeholder content
        const result = await messageService.createCompressionGroup({
          agentId,
          messageIds,
          topicId,
        });
        const { messageGroupId, messages: initialCompressedMessages, messagesToSummarize } = result;

        // 2. Update UI with compressed messages immediately
        context.get().replaceMessages(initialCompressedMessages, { context: opContext });

        // 3. Get model/provider from compressionModel config
        const { model, provider } = state.modelRuntimeConfig?.compressionModel || {};

        log(
          `${stagePrefix} Created group=%s, generating summary for %d messages by %s`,
          messageGroupId,
          messagesToSummarize.length,
          `${provider}/${model}`,
        );

        // 4. Build compression prompt and generate summary with streaming UI updates
        const compressionPayload = chainCompressContext(messagesToSummarize);
        let summaryContent = '';

        // Start generateSummary operation attached to the compressed group message
        const { operationId: summaryOperationId } = context.get().startOperation({
          context: { ...getOperationContext(), messageId: messageGroupId },
          type: 'generateSummary',
          parentOperationId: compressOperationId,
        });

        await chatService.fetchPresetTaskResult({
          params: { ...compressionPayload, model, provider },
          onMessageHandle: (chunk) => {
            if (chunk.type === 'text') {
              summaryContent += chunk.text || '';
              // Stream update the compression group message content
              context
                .get()
                .internal_dispatchMessage(
                  { id: messageGroupId, type: 'updateMessage', value: { content: summaryContent } },
                  { operationId: summaryOperationId },
                );
            }
          },
          onError: (e) => {
            console.error(e);
            context.get().completeOperation(summaryOperationId, {
              error: { message: String(e), type: 'summary_generation_failed' },
            });
          },
        });

        log(`${stagePrefix} Generated summary: %d chars`, summaryContent.length);

        // 5. Finalize compression with actual content
        const finalResult = await messageService.finalizeCompression({
          agentId,
          content: summaryContent,
          messageGroupId,
          topicId,
        });
        // Complete the generateSummary operation
        context.get().completeOperation(summaryOperationId);

        const compressedMessages = finalResult.messages || initialCompressedMessages;
        const groupId = messageGroupId;
        // Use the latest assistant message ID (before compression) as parentMessageId for next call_llm
        const parentMessageId = assistantMessageId;

        // 6. Update UI with finalized messages (includes compressedGroup with summary)
        context.get().replaceMessages(compressedMessages, { context: opContext });

        log(
          `${stagePrefix} Compression complete. groupId=%s, parentMessageId=%s`,
          groupId,
          parentMessageId,
        );

        // Complete the compress_context operation
        context.get().completeOperation(compressOperationId, { groupId, parentMessageId });

        events.push({ type: 'compression_complete', groupId, parentMessageId });

        // Calculate new token count
        const compressedTokenCount = calculateMessageTokens(compressedMessages);

        return {
          events,
          newState: { ...state, messages: compressedMessages },
          nextContext: {
            payload: {
              compressedMessages,
              compressedTokenCount,
              groupId,
              originalTokenCount: currentTokenCount,
              parentMessageId,
            } as GeneralAgentCompressionResultPayload,
            phase: 'compression_result',
            session: {
              messageCount: compressedMessages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      } catch (error) {
        log(`${stagePrefix} Compression failed: %O`, error);

        // Complete the compress_context operation with error
        context.get().completeOperation(compressOperationId, {
          error: {
            message: error instanceof Error ? error.message : String(error),
            type: 'compression_failed',
          },
        });

        // On error, continue without compression
        events.push({ type: 'compression_error', error });

        return {
          events,
          newState: state,
          nextContext: {
            payload: {
              compressedMessages: messages,
              skipped: true,
            } as GeneralAgentCompressionResultPayload,
            phase: 'compression_result',
            session: {
              messageCount: state.messages.length,
              sessionId: state.operationId,
              status: 'running',
              stepCount: state.stepCount + 1,
            },
          } as AgentRuntimeContext,
        };
      }
    },
  };

  return executors;
};
