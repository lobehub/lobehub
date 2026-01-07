import {
  type AgentEvent,
  type AgentInstruction,
  type CallLLMPayload,
  type GeneralAgentCallLLMResultPayload,
  type InstructionExecutor,
  UsageCounter,
} from '@lobechat/agent-runtime';
import { ToolNameResolver } from '@lobechat/context-engine';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import { type ChatToolPayload, type MessageToolCall } from '@lobechat/types';
import { serializePartsForStorage } from '@lobechat/utils';
import debug from 'debug';

import { type MessageModel } from '@/database/models/message';
import { type LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { type ToolExecutionService } from '@/server/services/toolExecution';

import type { IStreamEventManager } from './types';

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
  userId?: string;
}

export const createRuntimeExecutors = (
  ctx: RuntimeExecutorContext,
): Partial<Record<AgentInstruction['type'], InstructionExecutor>> => ({
  /**
   * 创建流式 LLM 执行器
   * 集成 Agent Runtime 和流式事件发布
   */
  call_llm: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_llm' }>;
    const llmPayload = payload as CallLLMPayload;
    const { operationId, stepIndex, streamManager } = ctx;
    const events: AgentEvent[] = [];

    // Fallback to state's modelRuntimeConfig if not in payload
    const model = llmPayload.model || state.modelRuntimeConfig?.model;
    const provider = llmPayload.provider || state.modelRuntimeConfig?.provider;

    if (!model || !provider) {
      throw new Error('Model and provider are required for call_llm instruction');
    }

    // 类型断言确保 payload 的正确性
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

    // 发布流式开始事件
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
      let imageList: any[] = [];
      let grounding: any = null;
      let currentStepUsage: any = undefined;

      // Multimodal content parts tracking
      type ContentPart = { text: string; type: 'text' } | { image: string; type: 'image' };
      let contentParts: ContentPart[] = [];
      let reasoningParts: ContentPart[] = [];
      let hasContentImages = false;
      let hasReasoningImages = false;

      // 初始化 ModelRuntime (从数据库读取用户的 keyVaults)
      const modelRuntime = await initModelRuntimeFromDB(ctx.serverDB, ctx.userId!, provider);

      // 构造 ChatStreamPayload
      const chatPayload = {
        messages: llmPayload.messages,
        model,
        tools: llmPayload.tools,
      };

      log(
        `${stagePrefix} calling model-runtime chat (model: %s, messages: %d, tools: %d)`,
        model,
        llmPayload.messages.length,
        llmPayload.tools?.length ?? 0,
      );

      // Buffer：累积 text 和 reasoning，每 50ms 发送一次
      const BUFFER_INTERVAL = 50;
      let textBuffer = '';
      let reasoningBuffer = '';
      // eslint-disable-next-line no-undef
      let textBufferTimer: NodeJS.Timeout | null = null;
      // eslint-disable-next-line no-undef
      let reasoningBufferTimer: NodeJS.Timeout | null = null;

      const flushTextBuffer = async () => {
        const delta = textBuffer;
        textBuffer = '';

        if (!!delta) {
          log(`[${operationLogId}] flushTextBuffer:`, delta);

          // 构建标准 Agent Runtime 事件
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

      // 调用 model-runtime chat
      const response = await modelRuntime.chat(chatPayload, {
        callback: {
          onCompletion: async (data) => {
            // 捕获 usage (可能包含 cost，也可能不包含)
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

            // 如果没有定时器，创建一个
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

            // Buffer reasoning 内容
            reasoningBuffer += reasoning;

            // 如果没有定时器，创建一个
            if (!reasoningBufferTimer) {
              reasoningBufferTimer = setTimeout(async () => {
                await flushReasoningBuffer();
                reasoningBufferTimer = null;
              }, BUFFER_INTERVAL);
            }
          },
          onToolsCalling: async ({ toolsCalling: raw }) => {
            const payload = new ToolNameResolver().resolve(raw, state.toolManifestMap);
            // log(`[${operationLogId}][toolsCalling]`, payload);
            toolsCalling = payload;
            tool_calls = raw;

            // 如果有 textBuffer,先推一次
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

      // 消费流确保所有回调执行完成
      await consumeStreamUntilDone(response);

      await flushTextBuffer();
      await flushReasoningBuffer();

      // 清理定时器并 flush 剩余 buffer
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

      // 日志输出 usage
      if (currentStepUsage) {
        log(`[${operationLogId}][usage] %O`, currentStepUsage);
      }

      // 添加一个完整的 llm_stream 事件（包含所有流式块）
      events.push({
        result: { content, reasoning: thinkingContent, tool_calls, usage: currentStepUsage },
        type: 'llm_result',
      });

      // 发布流式结束事件
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

      // ===== 1. 先保存原始 usage 到 message.metadata =====
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

      // ===== 2. 然后累加到 AgentState =====
      let newState = structuredClone(state);

      newState.messages.push({
        content,
        role: 'assistant',
        tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      });

      if (currentStepUsage) {
        // 使用 UsageCounter 统一累加 usage 和 cost
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
      // 发布错误事件
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
   * 工具执行
   */
  call_tool: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_tool' }>;
    const { operationId, stepIndex, streamManager, toolExecutionService } = ctx;
    const events: AgentEvent[] = [];

    const operationLogId = `${operationId}:${stepIndex}`;
    log(`[${operationLogId}] payload: %O`, payload);

    // 发布工具执行开始事件
    await streamManager.publishStreamEvent(operationId, {
      data: payload,
      stepIndex,
      type: 'tool_start',
    });

    try {
      // payload is { parentMessageId, toolCalling: ChatToolPayload }
      const chatToolPayload: ChatToolPayload = payload.toolCalling;

      const toolName = `${chatToolPayload.identifier}/${chatToolPayload.apiName}`;
      // Execute tool using ToolExecutionService
      log(`[${operationLogId}] Executing tool ${toolName} ...`);
      const executionResult = await toolExecutionService.executeTool(chatToolPayload, {
        toolManifestMap: state.toolManifestMap,
        userId: ctx.userId,
      });

      const executionTime = executionResult.executionTime;
      const isSuccess = executionResult.success;
      log(
        `[${operationLogId}] Executing ${toolName} in ${executionTime}ms, result: %O`,
        executionResult,
      );

      // 发布工具执行结果事件
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

      // 最终更新数据库
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

      // 获取工具单价
      const toolCost = TOOL_PRICING[toolName] || 0;

      // 使用 UsageCounter 统一累加 tool usage
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

      // 查找当前工具的统计信息
      const currentToolStats = usage.tools.byTool.find((t) => t.name === toolName);

      // 日志输出 usage
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
      // 发布工具执行错误事件
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
        newState: state, // 状态不变
      };
    }
  },
  /**
   * 完成 runtime 运行
   */
  finish: async (instruction, state) => {
    const { reason, reasonDetail } = instruction as Extract<AgentInstruction, { type: 'finish' }>;
    const { operationId, stepIndex, streamManager } = ctx;

    log('[%s:%d] Finishing execution: (%s)', operationId, stepIndex, reason);

    // 发布执行完成事件
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
   * 人工审批
   */
  request_human_approve: async (instruction, state) => {
    const { pendingToolsCalling } = instruction as Extract<
      AgentInstruction,
      { type: 'request_human_approve' }
    >;
    const { operationId, stepIndex, streamManager } = ctx;

    log('[%s:%d] Requesting human approval for %O', operationId, stepIndex, pendingToolsCalling);

    // 发布人工审批请求事件
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

    // 通过流式系统通知前端显示审批 UI
    await streamManager.publishStreamChunk(operationId, stepIndex, {
      // 使用 operationId 作为 messageId
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
      // 不提供 nextContext，因为需要等待人工干预
    };
  },

  /**
   * 解决被取消的工具调用
   * 为取消的工具调用创建带有 'aborted' 干预状态的工具消息
   */
  resolve_aborted_tools: async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'resolve_aborted_tools' }>;
    const { parentMessageId, toolsCalling } = payload;
    const { operationId, stepIndex, streamManager } = ctx;
    const events: AgentEvent[] = [];

    log('[%s:%d] Resolving %d aborted tools', operationId, stepIndex, toolsCalling.length);

    // 发布工具取消事件
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

    // 为每个取消的工具调用创建 tool message
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

        // 更新 state messages
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

    // 标记状态为完成
    newState.lastModified = new Date().toISOString();
    newState.status = 'done';

    // 发布完成事件
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
