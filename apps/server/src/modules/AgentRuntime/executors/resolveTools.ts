import {
  type AgentEvent,
  type AgentInstruction,
  type InstructionExecutor,
} from '@lobechat/agent-runtime';

import { type ToolExecutionResultResponse } from '@/server/services/toolExecution';

import { type RuntimeExecutorContext } from '../context';
import { log } from '../executorHelpers';
import { formatErrorEventData } from '../formatErrorEventData';
import {
  createConversationParentMissingError,
  isMidOperationReferenceMissingError,
} from '../messagePersistErrors';

export const resolveBlockedTools =
  (ctx: RuntimeExecutorContext): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'resolve_blocked_tools' }>;
    const { parentMessageId, toolsCalling } = payload;
    const { operationId, stepIndex, streamManager } = ctx;
    const events: AgentEvent[] = [];
    const newState = structuredClone(state);
    const toolResults: Array<{ data: ToolExecutionResultResponse; toolCallId: string }> = [];
    const toolMessageIds: string[] = [];

    log('[%s:%d] Resolving %d blocked tools', operationId, stepIndex, toolsCalling.length);

    for (const toolPayload of toolsCalling) {
      const result: ToolExecutionResultResponse = {
        content: 'Blocked by security/privacy.',
        error: 'blocked_by_security_privacy',
        executionTime: 0,
        state: { type: 'blocked' },
        success: false,
      };

      await streamManager.publishStreamEvent(operationId, {
        data: {
          executionTime: 0,
          isSuccess: false,
          attempts: 0,
          maxAttempts: 0,
          payload: { parentMessageId, toolCalling: toolPayload },
          phase: 'tool_execution',
          result,
        },
        stepIndex,
        type: 'tool_end',
      });

      try {
        const toolMessage = await ctx.messageModel.create({
          agentId: state.metadata!.agentId!,
          content: result.content,
          groupId: state.metadata?.groupId ?? undefined,
          metadata: { toolExecutionTimeMs: 0 },
          parentId: parentMessageId,
          plugin: toolPayload as any,
          pluginError: result.error,
          pluginIntervention: { rejectedReason: result.error, status: 'rejected' },
          pluginState: result.state,
          role: 'tool',
          threadId: state.metadata?.threadId,
          tool_call_id: toolPayload.id,
          topicId: state.metadata?.topicId,
        });
        toolMessageIds.push(toolMessage.id);
      } catch (error) {
        console.error('[resolve_blocked_tools] Failed to create blocked tool message: %O', error);
        const fatal = isMidOperationReferenceMissingError(error)
          ? createConversationParentMissingError(parentMessageId, error)
          : error instanceof Error
            ? error
            : new Error(String(error));
        await streamManager.publishStreamEvent(operationId, {
          data: formatErrorEventData(fatal, 'tool_message_persist'),
          stepIndex,
          type: 'error',
        });
        throw fatal;
      }

      newState.messages.push({
        content: result.content,
        role: 'tool',
        tool_call_id: toolPayload.id,
      });
      events.push({ id: toolPayload.id, result, type: 'tool_result' });
      toolResults.push({ data: result, toolCallId: toolPayload.id });
    }

    newState.lastModified = new Date().toISOString();

    return {
      events,
      newState,
      nextContext: {
        payload: {
          parentMessageId: toolMessageIds.at(-1) ?? parentMessageId,
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
  };

export const resolveAbortedTools =
  (ctx: RuntimeExecutorContext): InstructionExecutor =>
  async (instruction, state) => {
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
          groupId: state.metadata?.groupId ?? undefined,
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
        // Normalize BEFORE publishing so clients surface the typed business
        // error instead of the raw driver text (see review).
        const fatal = isMidOperationReferenceMissingError(error)
          ? createConversationParentMissingError(parentMessageId, error)
          : error instanceof Error
            ? error
            : new Error(String(error));
        await streamManager.publishStreamEvent(operationId, {
          data: formatErrorEventData(fatal, 'tool_message_persist'),
          stepIndex,
          type: 'error',
        });
        throw fatal;
      }
    }

    log('[%s:%d] All aborted tool messages created', operationId, stepIndex);

    // Mark status as complete
    newState.lastModified = new Date().toISOString();
    newState.status = 'done';

    // Publish completion event. finalState stripped centrally inside
    // `publishStreamEvent`.
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
  };
