import {
  type AgentEvent,
  type AgentInstruction,
  type CallLLMPayload,
  type GeneralAgentCallLLMResultPayload,
  type InstructionExecutor,
} from '@lobechat/agent-runtime';
import { UsageCounter } from '@lobechat/agent-runtime';
import { ToolNameResolver } from '@lobechat/context-engine';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import { type ChatToolPayload, type MessageToolCall } from '@lobechat/types';
import { serializePartsForStorage } from '@lobechat/utils';
import debug from 'debug';

import { type MessageModel } from '@/database/models/message';
import { type LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { type ToolExecutionService } from '@/server/services/toolExecution';

import { type IStreamEventManager } from './types';

const log = debug('lobe-server:agent-runtime:streaming-executors');
const timing = debug('lobe-server:agent-runtime:timing');

// Tool pricing configuration (USD per call)
const TOOL_PRICING: Record<string, number> = {
  'lobe-web-browsing/craw': 0.002,
  'lobe-web-browsing/search': 0.001,
};

export interface RuntimeExecutorContext {
  fileService?: any;
  messageModel: MessageModel;
  operationId: string;
  serverDB: LobeChatDatabase;
  stepIndex: number;
  streamManager: IStreamEventManager;
  toolExecutionService: ToolExecutionService;
  topicId?: string;
  userId?: string;
}

export const createRuntimeExecutors = (
  ctx: RuntimeExecutorContext,
): Partial<Record<AgentInstruction['type'], InstructionExecutor>> => ({
  /**
   * Create streaming LLM executor
   * Integrates Agent Runtime and stream event publishing
   */
  call_llm: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_llm' }>;
    const llmPayload = payload as CallLLMPayload;
    const { operationId, stepIndex, streamManager } = ctx;
    const events: AgentEvent[] = [];

    // Fallback to state's modelRuntimeConfig if not in payload
    const model = llmPayload.model || state.modelRuntimeConfig?.model;
    const provider = llmPayload.provider || state.modelRuntimeConfig?.provider;
    // Fallback to state's tools if not in payload
    const tools = llmPayload.tools || state.tools;

    if (!model || !provider) {
      throw new Error('Model and provider are required for call_llm instruction');
    }

    // Type assertion to ensure payload correctness
    const operationLogId = `${operationId}:${stepIndex}`;

    const stagePrefix = `[${operationLogId}][call_llm]`;

    log(`${stagePrefix} Starting operation`);

    // Get parentId from payload (parentId or parentMessageId depending on payload type)
    const parentId = llmPayload.parentId || (llmPayload as any).parentMessageId;

    // Get or create assistant message
    // If assistantMessageId is provided in payload, use existing message instead of creating new one
    const existingAssistantMessageId = (llmPayload as any).assistantMessageId;
    let assistantMessageItem: { id: string };

    if (existingAssistantMessageId) {
      // Use existing assistant message (created by execAgent)
      assistantMessageItem = { id: existingAssistantMessageId };
      log(`${stagePrefix} Using existing assistant message: %s`, existingAssistantMessageId);
    } else {
      // Create new assistant message (legacy behavior)
      assistantMessageItem = await ctx.messageModel.create({
        agentId: state.metadata!.agentId!,
        content: '',
        model,
        parentId,
        provider,
        role: 'assistant',
        threadId: state.metadata?.threadId,
        topicId: state.metadata?.topicId,
      });
      log(`${stagePrefix} Created new assistant message: %s`, assistantMessageItem.id);
    }

    // Publish stream start event
    await streamManager.publishStreamEvent(operationId, {
      data: {
        assistantMessage: assistantMessageItem,
        model,
        provider,
      },
      stepIndex,
      type: 'stream_start',
    });

    try {
      let content = '';
      let toolsCalling: ChatToolPayload[] = [];
      let tool_calls: MessageToolCall[] = [];
      let thinkingContent = '';
      const imageList: any[] = [];
      let grounding: any = null;
      let currentStepUsage: any = undefined;

      // Multimodal content parts tracking
      type ContentPart = { text: string; type: 'text' } | { image: string; type: 'image' };
      const contentParts: ContentPart[] = [];
      const reasoningParts: ContentPart[] = [];
      const hasContentImages = false;
      const hasReasoningImages = false;

      // Initialize ModelRuntime (read user's keyVaults from database)
      const modelRuntime = await initModelRuntimeFromDB(ctx.serverDB, ctx.userId!, provider);

      // Construct ChatStreamPayload
      const chatPayload = {
        messages: llmPayload.messages,
        model,
        tools,
      };

      log(
        `${stagePrefix} calling model-runtime chat (model: %s, messages: %d, tools: %d)`,
        model,
        llmPayload.messages.length,
        tools?.length ?? 0,
      );

      // Buffer: accumulate text and reasoning, send every 50ms
      const BUFFER_INTERVAL = 50;
      let textBuffer = '';
      let reasoningBuffer = '';

      let textBufferTimer: NodeJS.Timeout | null = null;

      let reasoningBufferTimer: NodeJS.Timeout | null = null;

      const flushTextBuffer = async () => {
        const delta = textBuffer;
        textBuffer = '';

        if (!!delta) {
          log(`[${operationLogId}] flushTextBuffer:`, delta);

          // Build standard Agent Runtime event
          events.push({
            chunk: { text: delta, type: 'text' },
            type: 'llm_stream',
          });

          const publishStart = Date.now();
          await streamManager.publishStreamChunk(operationId, stepIndex, {
            chunkType: 'text',
            content: delta,
          });
          timing(
            '[%s] flushTextBuffer published at %d, took %dms, length: %d',
            operationLogId,
            publishStart,
            Date.now() - publishStart,
            delta.length,
          );
        }
      };

      const flushReasoningBuffer = async () => {
        const delta = reasoningBuffer;

        reasoningBuffer = '';

        if (!!delta) {
          log(`[${operationLogId}] flushReasoningBuffer:`, delta);

          events.push({
            chunk: { text: delta, type: 'reasoning' },
            type: 'llm_stream',
          });

          const publishStart = Date.now();
          await streamManager.publishStreamChunk(operationId, stepIndex, {
            chunkType: 'reasoning',
            reasoning: delta,
          });
          timing(
            '[%s] flushReasoningBuffer published at %d, took %dms, length: %d',
            operationLogId,
            publishStart,
            Date.now() - publishStart,
            delta.length,
          );
        }
      };

      // Call model-runtime chat
      const response = await modelRuntime.chat(chatPayload, {
        callback: {
          onCompletion: async (data) => {
            // Capture usage (may or may not include cost)
            if (data.usage) {
              currentStepUsage = data.usage;
            }
          },
          onGrounding: async (groundingData) => {
            log(`[${operationLogId}][grounding] %O`, groundingData);
            grounding = groundingData;

            await streamManager.publishStreamChunk(operationId, stepIndex, {
              chunkType: 'grounding',
              grounding: groundingData,
            });
          },
          onText: async (text) => {
            timing(
              '[%s] onText received chunk at %d, length: %d',
              operationLogId,
              Date.now(),
              text.length,
            );
            content += text;

            textBuffer += text;

            // If no timer exists, create one
            if (!textBufferTimer) {
              textBufferTimer = setTimeout(async () => {
                await flushTextBuffer();
                textBufferTimer = null;
              }, BUFFER_INTERVAL);
            }
          },
          onThinking: async (reasoning) => {
            timing(
              '[%s] onThinking received chunk at %d, length: %d',
              operationLogId,
              Date.now(),
              reasoning.length,
            );
            thinkingContent += reasoning;

            // Buffer reasoning content
            reasoningBuffer += reasoning;

            // If no timer exists, create one
            if (!reasoningBufferTimer) {
              reasoningBufferTimer = setTimeout(async () => {
                await flushReasoningBuffer();
                reasoningBufferTimer = null;
              }, BUFFER_INTERVAL);
            }
          },
          onToolsCalling: async ({ toolsCalling: raw }) => {
            const resolved = new ToolNameResolver().resolve(raw, state.toolManifestMap);
            // Add source field from toolSourceMap for routing tool execution
            const payload = resolved.map((p) => ({
              ...p,
              source: state.toolSourceMap?.[p.identifier],
            }));
            // log(`[${operationLogId}][toolsCalling]`, payload);
            toolsCalling = payload;
            tool_calls = raw;

            // If textBuffer exists, flush it first
            if (!!textBuffer) {
              await flushTextBuffer();
            }

            await streamManager.publishStreamChunk(operationId, stepIndex, {
              chunkType: 'tools_calling',
              toolsCalling: payload,
            });
          },
        },
        user: ctx.userId,
      });

      // Consume stream to ensure all callbacks complete execution
      await consumeStreamUntilDone(response);

      await flushTextBuffer();
      await flushReasoningBuffer();

      // Clean up timers and flush remaining buffers
      if (textBufferTimer) {
        clearTimeout(textBufferTimer);
        textBufferTimer = null;
      }

      if (reasoningBufferTimer) {
        clearTimeout(reasoningBufferTimer);
        reasoningBufferTimer = null;
      }

      log(`[${operationLogId}] finish model-runtime calling`);

      if (thinkingContent) {
        log(`[${operationLogId}][reasoning]`, thinkingContent);
      }
      if (content) {
        log(`[${operationLogId}][content]`, content);
      }
      if (toolsCalling.length > 0) {
        log(`[${operationLogId}][toolsCalling] `, toolsCalling);
      }

      // Log usage information
      if (currentStepUsage) {
        log(`[${operationLogId}][usage] %O`, currentStepUsage);
      }

      // Add a complete llm_stream event (including all streaming chunks)
      events.push({
        result: { content, reasoning: thinkingContent, tool_calls, usage: currentStepUsage },
        type: 'llm_result',
      });

      // Publish stream end event
      await streamManager.publishStreamEvent(operationId, {
        data: {
          finalContent: content,
          grounding: grounding,
          imageList: imageList.length > 0 ? imageList : undefined,
          reasoning: thinkingContent || undefined,
          toolsCalling: toolsCalling,
          usage: currentStepUsage,
        },
        stepIndex,
        type: 'stream_end',
      });

      log('[%s:%d] call_llm completed', operationId, stepIndex);

      // ===== 1. First save original usage to message.metadata =====
      // Determine final content - use serialized parts if has images, otherwise plain text
      const finalContent = hasContentImages ? serializePartsForStorage(contentParts) : content;

      // Determine final reasoning - handle multimodal reasoning
      let finalReasoning: any = undefined;
      if (hasReasoningImages) {
        // Has images, use multimodal format
        finalReasoning = {
          content: serializePartsForStorage(reasoningParts),
          isMultimodal: true,
        };
      } else if (thinkingContent) {
        // Has text from reasoning but no images
        finalReasoning = {
          content: thinkingContent,
        };
      }

      try {
        // Build metadata object
        const metadata: Record<string, any> = {};
        if (currentStepUsage && typeof currentStepUsage === 'object') {
          Object.assign(metadata, currentStepUsage);
        }
        if (hasContentImages) {
          metadata.isMultimodal = true;
        }

        await ctx.messageModel.update(assistantMessageItem.id, {
          content: finalContent,
          imageList: imageList.length > 0 ? imageList : undefined,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          reasoning: finalReasoning,
          search: grounding,
          tools: toolsCalling.length > 0 ? toolsCalling : undefined,
        });
      } catch (error) {
        console.error('[call_llm] Failed to update message:', error);
      }

      // ===== 2. Then accumulate to AgentState =====
      const newState = structuredClone(state);

      newState.messages.push({
        content,
        role: 'assistant',
        tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      });

      if (currentStepUsage) {
        // Use UsageCounter to uniformly accumulate usage and cost
        const { usage, cost } = UsageCounter.accumulateLLM({
          cost: newState.cost,
          model: llmPayload.model,
          modelUsage: currentStepUsage,
          provider: llmPayload.provider,
          usage: newState.usage,
        });

        newState.usage = usage;
        if (cost) newState.cost = cost;
      }

      return {
        events,
        newState,
        nextContext: {
          payload: {
            hasToolsCalling: toolsCalling.length > 0,
            // Pass assistant message ID as parentMessageId for tool calls
            parentMessageId: assistantMessageItem.id,
            result: { content, tool_calls },
            toolsCalling: toolsCalling,
          } as GeneralAgentCallLLMResultPayload,
          phase: 'llm_result',
          session: {
            eventCount: events.length,
            messageCount: newState.messages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
          stepUsage: currentStepUsage,
        },
      };
    } catch (error) {
      // Publish error event
      await streamManager.publishStreamEvent(operationId, {
        data: {
          error: (error as Error).message,
          phase: 'llm_execution',
        },
        stepIndex,
        type: 'error',
      });

      console.error(
        `[StreamingLLMExecutor][${operationId}:${stepIndex}] LLM execution failed:`,
        error,
      );
      throw error;
    }
  },
  /**
   * Tool execution
   */
  call_tool: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_tool' }>;
    const { operationId, stepIndex, streamManager, toolExecutionService } = ctx;
    const events: AgentEvent[] = [];

    const operationLogId = `${operationId}:${stepIndex}`;
    log(`[${operationLogId}] payload: %O`, payload);

    // Publish tool execution start event
    await streamManager.publishStreamEvent(operationId, {
      data: payload,
      stepIndex,
      type: 'tool_start',
    });

    try {
      // payload is { parentMessageId, toolCalling: ChatToolPayload }
      const chatToolPayload: ChatToolPayload = payload.toolCalling;

      const toolName = `${chatToolPayload.identifier}/${chatToolPayload.apiName}`;

      // Extract toolResultMaxLength from agent config
      const agentConfig = state.metadata?.agentConfig;
      const toolResultMaxLength = agentConfig?.chatConfig?.toolResultMaxLength;

      // Execute tool using ToolExecutionService
      log(`[${operationLogId}] Executing tool ${toolName} ...`);
      const executionResult = await toolExecutionService.executeTool(chatToolPayload, {
        serverDB: ctx.serverDB,
        toolManifestMap: state.toolManifestMap,
        toolResultMaxLength,
        topicId: ctx.topicId,
        userId: ctx.userId,
      });

      const executionTime = executionResult.executionTime;
      const isSuccess = executionResult.success;
      log(
        `[${operationLogId}] Executing ${toolName} in ${executionTime}ms, result: %O`,
        executionResult,
      );

      // Publish tool execution result event
      await streamManager.publishStreamEvent(operationId, {
        data: {
          executionTime,
          isSuccess,
          payload,
          phase: 'tool_execution',
          result: executionResult,
        },
        stepIndex,
        type: 'tool_end',
      });

      // Finally update database
      let toolMessageId: string | undefined;
      try {
        const toolMessage = await ctx.messageModel.create({
          agentId: state.metadata!.agentId!,
          content: executionResult.content,
          parentId: payload.parentMessageId,
          plugin: chatToolPayload as any,
          pluginError: executionResult.error,
          pluginState: executionResult.state,
          role: 'tool',
          threadId: state.metadata?.threadId,
          tool_call_id: chatToolPayload.id,
          topicId: state.metadata?.topicId,
        });
        toolMessageId = toolMessage.id;
      } catch (error) {
        console.error('[StreamingToolExecutor] Failed to create tool message: %O', error);
      }

      const newState = structuredClone(state);

      newState.messages.push({
        content: executionResult.content,
        role: 'tool',
        tool_call_id: chatToolPayload.id,
      });

      events.push({ id: chatToolPayload.id, result: executionResult, type: 'tool_result' });

      // Get tool unit price
      const toolCost = TOOL_PRICING[toolName] || 0;

      // Use UsageCounter to uniformly accumulate tool usage
      const { usage, cost } = UsageCounter.accumulateTool({
        cost: newState.cost,
        executionTime,
        success: isSuccess,
        toolCost,
        toolName,
        usage: newState.usage,
      });

      newState.usage = usage;
      if (cost) newState.cost = cost;

      // Find current tool statistics
      const currentToolStats = usage.tools.byTool.find((t) => t.name === toolName);

      // Log usage information
      log(
        `[${operationLogId}][tool usage] %s: calls=%d, time=%dms, success=%s, cost=$%s`,
        toolName,
        currentToolStats?.calls || 0,
        executionTime,
        isSuccess,
        toolCost.toFixed(4),
      );

      log('[%s:%d] Tool execution completed', operationId, stepIndex);

      return {
        events,
        newState,
        nextContext: {
          payload: {
            data: executionResult,
            executionTime,
            isSuccess,
            // Pass tool message ID as parentMessageId for the next LLM call
            parentMessageId: toolMessageId,
            toolCall: chatToolPayload,
            toolCallId: chatToolPayload.id,
          },
          phase: 'tool_result',
          session: {
            eventCount: events.length,
            messageCount: newState.messages.length,
            sessionId: operationId,
            status: 'running',
            stepCount: state.stepCount + 1,
          },
          stepUsage: {
            cost: toolCost,
            toolName,
            unitPrice: toolCost,
            usageCount: 1,
          },
        },
      };
    } catch (error) {
      // Publish tool execution error event
      await streamManager.publishStreamEvent(operationId, {
        data: {
          error: (error as Error).message,
          phase: 'tool_execution',
        },
        stepIndex,
        type: 'error',
      });

      events.push({
        error: error,
        type: 'error',
      });

      console.error(
        `[StreamingToolExecutor] Tool execution failed for operation ${operationId}:${stepIndex}:`,
        error,
      );

      return {
        events,
        newState: state, // State unchanged
      };
    }
  },

  /**
   * Batch tool execution with database sync
   * Executes multiple tools concurrently and refreshes messages from database after completion
   */
  call_tools_batch: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_tools_batch' }>;
    const { parentMessageId, toolsCalling } = payload;
    const { operationId, stepIndex, streamManager, toolExecutionService } = ctx;
    const events: AgentEvent[] = [];

    const operationLogId = `${operationId}:${stepIndex}`;
    log(
      `[${operationLogId}][call_tools_batch] Starting batch execution for ${toolsCalling.length} tools`,
    );

    // Track all tool message IDs created during execution
    const toolMessageIds: string[] = [];
    const toolResults: any[] = [];

    // Execute all tools concurrently
    await Promise.all(
      toolsCalling.map(async (chatToolPayload: ChatToolPayload) => {
        const toolName = `${chatToolPayload.identifier}/${chatToolPayload.apiName}`;

        // Publish tool execution start event
        await streamManager.publishStreamEvent(operationId, {
          data: { parentMessageId, toolCalling: chatToolPayload },
          stepIndex,
          type: 'tool_start',
        });

        try {
          log(`[${operationLogId}] Executing tool ${toolName} ...`);
          const executionResult = await toolExecutionService.executeTool(chatToolPayload, {
            serverDB: ctx.serverDB,
            toolManifestMap: state.toolManifestMap,
            topicId: ctx.topicId,
            userId: ctx.userId,
          });

          const executionTime = executionResult.executionTime;
          const isSuccess = executionResult.success;
          log(
            `[${operationLogId}] Executed ${toolName} in ${executionTime}ms, success: ${isSuccess}`,
          );

          // Publish tool execution result event
          await streamManager.publishStreamEvent(operationId, {
            data: {
              executionTime,
              isSuccess,
              payload: { parentMessageId, toolCalling: chatToolPayload },
              phase: 'tool_execution',
              result: executionResult,
            },
            stepIndex,
            type: 'tool_end',
          });

          // Create tool message in database
          try {
            const toolMessage = await ctx.messageModel.create({
              agentId: state.metadata!.agentId!,
              content: executionResult.content,
              parentId: parentMessageId,
              plugin: chatToolPayload as any,
              pluginError: executionResult.error,
              pluginState: executionResult.state,
              role: 'tool',
              threadId: state.metadata?.threadId,
              tool_call_id: chatToolPayload.id,
              topicId: state.metadata?.topicId,
            });
            toolMessageIds.push(toolMessage.id);
            log(`[${operationLogId}] Created tool message ${toolMessage.id} for ${toolName}`);
          } catch (error) {
            console.error(
              `[${operationLogId}] Failed to create tool message for ${toolName}:`,
              error,
            );
          }

          // Collect tool result
          toolResults.push({
            data: executionResult,
            executionTime,
            isSuccess,
            toolCall: chatToolPayload,
            toolCallId: chatToolPayload.id,
          });

          events.push({ id: chatToolPayload.id, result: executionResult, type: 'tool_result' });

          // Accumulate usage
          const toolCost = TOOL_PRICING[toolName] || 0;
          UsageCounter.accumulateTool({
            cost: state.cost,
            executionTime,
            success: isSuccess,
            toolCost,
            toolName,
            usage: state.usage,
          });
        } catch (error) {
          console.error(`[${operationLogId}] Tool execution failed for ${toolName}:`, error);

          // Publish error event
          await streamManager.publishStreamEvent(operationId, {
            data: {
              error: (error as Error).message,
              phase: 'tool_execution',
            },
            stepIndex,
            type: 'error',
          });

          events.push({ error, type: 'error' });
        }
      }),
    );

    log(
      `[${operationLogId}][call_tools_batch] All tools executed, created ${toolMessageIds.length} tool messages`,
    );

    // Refresh messages from database to ensure state is in sync
    const newState = structuredClone(state);

    // Query latest messages from database
    // Must pass agentId to ensure correct query scope, otherwise when topicId is undefined,
    // the query will use isNull(topicId) condition which won't find messages with actual topicId
    const latestMessages = await ctx.messageModel.query({
      agentId: state.metadata?.agentId,
      threadId: state.metadata?.threadId,
      topicId: state.metadata?.topicId,
    });

    // Convert DB messages to LLM format with id
    newState.messages = latestMessages.map((msg: any) => ({
      content: msg.content,
      id: msg.id,
      role: msg.role,
      tool_call_id: msg.tool_call_id,
      tool_calls: msg.tool_calls,
    }));

    log(
      `[${operationLogId}][call_tools_batch] Refreshed ${newState.messages.length} messages from database`,
    );

    // Get the last tool message ID as parentMessageId for next LLM call
    const lastToolMessageId = toolMessageIds.at(-1);

    return {
      events,
      newState,
      nextContext: {
        payload: {
          parentMessageId: lastToolMessageId ?? parentMessageId,
          toolCount: toolsCalling.length,
          toolResults,
        },
        phase: 'tools_batch_result',
        session: {
          eventCount: events.length,
          messageCount: newState.messages.length,
          sessionId: operationId,
          status: 'running',
          stepCount: state.stepCount + 1,
        },
      },
    };
  },

  /**
   * Complete runtime execution
   */
  finish: async (instruction, state) => {
    const { reason, reasonDetail } = instruction as Extract<AgentInstruction, { type: 'finish' }>;
    const { operationId, stepIndex, streamManager } = ctx;

    log('[%s:%d] Finishing execution: (%s)', operationId, stepIndex, reason);

    // Publish execution complete event
    await streamManager.publishStreamEvent(operationId, {
      data: {
        finalState: { ...state, status: 'done' },
        phase: 'execution_complete',
        reason,
        reasonDetail,
      },
      stepIndex,
      type: 'step_complete',
    });

    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.status = 'done';

    const events: AgentEvent[] = [
      {
        finalState: newState,
        reason,
        reasonDetail,
        type: 'done',
      },
    ];

    return { events, newState };
  },

  /**
   * Human approval
   */
  request_human_approve: async (instruction, state) => {
    const { pendingToolsCalling } = instruction as Extract<
      AgentInstruction,
      { type: 'request_human_approve' }
    >;
    const { operationId, stepIndex, streamManager } = ctx;

    log('[%s:%d] Requesting human approval for %O', operationId, stepIndex, pendingToolsCalling);

    // Publish human approval request event
    await streamManager.publishStreamEvent(operationId, {
      data: {
        pendingToolsCalling,
        phase: 'human_approval',
        requiresApproval: true,
      },
      stepIndex,
      type: 'step_start',
    });

    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.status = 'waiting_for_human';
    newState.pendingToolsCalling = pendingToolsCalling;

    // Notify frontend to display approval UI through streaming system
    await streamManager.publishStreamChunk(operationId, stepIndex, {
      // Use operationId as messageId
      chunkType: 'tools_calling',
      toolsCalling: pendingToolsCalling as any,
    });

    const events: AgentEvent[] = [
      {
        operationId,
        pendingToolsCalling,
        type: 'human_approve_required',
      },
      {
        // Note: pendingToolsCalling is ChatToolPayload[] but AgentEventToolPending expects ToolsCalling[]
        // This is intentional for display purposes in the frontend
        toolCalls: pendingToolsCalling as any,
        type: 'tool_pending',
      },
    ];

    log('Human approval requested for operation %s:%d', operationId, stepIndex);

    return {
      events,
      newState,
      // Do not provide nextContext as it requires waiting for human intervention
    };
  },

  /**
   * Resolve aborted tool calls
   * Create tool messages with 'aborted' intervention status for canceled tool calls
   */
  resolve_aborted_tools: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'resolve_aborted_tools' }>;
    const { parentMessageId, toolsCalling } = payload;
    const { operationId, stepIndex, streamManager } = ctx;
    const events: AgentEvent[] = [];

    log('[%s:%d] Resolving %d aborted tools', operationId, stepIndex, toolsCalling.length);

    // Publish tool cancellation event
    await streamManager.publishStreamEvent(operationId, {
      data: {
        parentMessageId,
        phase: 'tools_aborted',
        toolsCalling,
      },
      stepIndex,
      type: 'step_start',
    });

    const newState = structuredClone(state);

    // Create tool message for each canceled tool call
    for (const toolPayload of toolsCalling) {
      const toolName = `${toolPayload.identifier}/${toolPayload.apiName}`;
      log('[%s:%d] Creating aborted tool message for %s', operationId, stepIndex, toolName);

      try {
        const toolMessage = await ctx.messageModel.create({
          agentId: state.metadata!.agentId!,
          content: 'Tool execution was aborted by user.',
          parentId: parentMessageId,
          plugin: toolPayload as any,
          pluginIntervention: { status: 'aborted' },
          role: 'tool',
          threadId: state.metadata?.threadId,
          tool_call_id: toolPayload.id,
          topicId: state.metadata?.topicId,
        });

        log(
          '[%s:%d] Created aborted tool message: %s for %s',
          operationId,
          stepIndex,
          toolMessage.id,
          toolName,
        );

        // Update state messages
        newState.messages.push({
          content: 'Tool execution was aborted by user.',
          role: 'tool',
          tool_call_id: toolPayload.id,
        });
      } catch (error) {
        console.error(
          '[resolve_aborted_tools] Failed to create aborted tool message for %s: %O',
          toolName,
          error,
        );
      }
    }

    log('[%s:%d] All aborted tool messages created', operationId, stepIndex);

    // Mark status as complete
    newState.lastModified = new Date().toISOString();
    newState.status = 'done';

    // Publish completion event
    await streamManager.publishStreamEvent(operationId, {
      data: {
        finalState: newState,
        phase: 'execution_complete',
        reason: 'user_aborted',
        reasonDetail: 'User aborted operation with pending tool calls',
      },
      stepIndex,
      type: 'step_complete',
    });

    events.push({
      finalState: newState,
      reason: 'user_aborted',
      reasonDetail: 'User aborted operation with pending tool calls',
      type: 'done',
    });

    return { events, newState };
  },
});
