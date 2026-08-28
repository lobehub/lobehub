import type { AgentRuntimeHost, ToolRunResult } from '../transport';
import type {
  AgentEvent,
  AgentInstruction,
  AgentRuntimeContext,
  AgentState,
  InstructionExecutor,
} from '../types';
import { publishPersistError, settleAbortedToolRows } from './abortedToolRows';

const BLOCKED_TOOL_CONTENT = 'Blocked by security/privacy.';
const BLOCKED_TOOL_ERROR = 'blocked_by_security_privacy';
const USER_ABORTED_REASON = 'user_aborted';
const USER_ABORTED_REASON_DETAIL = 'User aborted operation with pending tool calls';

type RuntimeSessionWithEventCount = NonNullable<AgentRuntimeContext['session']> & {
  eventCount?: number;
};

const createSession = (state: AgentState, operationId: string): RuntimeSessionWithEventCount => ({
  messageCount: state.messages.length,
  sessionId: operationId,
  status: state.status,
  stepCount: state.stepCount + 1,
});

/**
 * `resolve_blocked_tools` executor — turns policy-blocked tool calls into
 * persisted rejected tool messages so the runtime can continue planning.
 */
export const resolveBlockedTools =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'resolve_blocked_tools' }>;
    const { operation, transports } = host;
    const agentId = operation.agentId ?? state.metadata?.agentId;
    const groupId = operation.groupId ?? state.metadata?.groupId;
    const threadId = operation.threadId ?? state.metadata?.threadId;
    const topicId = operation.topicId ?? state.metadata?.topicId;
    const events: AgentEvent[] = [];
    const newState = structuredClone(state);
    const blockedContent = payload.blockedContent ?? BLOCKED_TOOL_CONTENT;
    const blockedReason = payload.blockedReason ?? BLOCKED_TOOL_ERROR;
    const toolResults: Array<{ data: ToolRunResult; toolCallId: string }> = [];
    const toolMessageIds: string[] = [];

    if (!agentId) {
      throw new Error(
        `[resolve_blocked_tools] Missing agentId for tool messages (op=${operation.operationId})`,
      );
    }

    for (const toolPayload of payload.toolsCalling) {
      const result: ToolRunResult = {
        content: blockedContent,
        error: blockedReason,
        executionTime: 0,
        state: {
          ...(payload.blockedReason && { reason: blockedReason }),
          type: 'blocked',
        },
        success: false,
      };

      await transports.stream.publishEvent({
        data: {
          executionTime: 0,
          isSuccess: false,
          attempts: 0,
          maxAttempts: 0,
          payload: { parentMessageId: payload.parentMessageId, toolCalling: toolPayload },
          phase: 'tool_execution',
          result,
        },
        stepIndex: operation.stepIndex,
        type: 'tool_end',
      });

      let toolMessageId: string;
      try {
        const toolMessage = await transports.messages.createToolMessage({
          agentId,
          content: result.content,
          groupId,
          metadata: { toolExecutionTimeMs: 0 },
          parentId: payload.parentMessageId,
          plugin: toolPayload as any,
          pluginError: result.error,
          pluginIntervention: {
            rejectedReason: blockedReason,
            status: 'rejected',
          },
          pluginState: result.state,
          role: 'tool',
          threadId,
          tool_call_id: toolPayload.id,
          topicId,
        });
        toolMessageId = toolMessage.id;
        toolMessageIds.push(toolMessageId);
      } catch (error) {
        await publishPersistError(host, error);
        throw error;
      }

      /** Keep the persisted id so the next gateway step can resolve media refs. */
      newState.messages.push({
        content: result.content,
        id: toolMessageId,
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
          parentMessageId: toolMessageIds.at(-1) ?? payload.parentMessageId,
          toolCount: payload.toolsCalling.length,
          toolResults,
        },
        phase: 'tools_batch_result',
        session: {
          ...createSession(newState, operation.operationId),
          eventCount: events.length,
        },
      },
    };
  };

/**
 * `resolve_aborted_tools` executor — persists cancelled tool calls and marks
 * the operation as completed by user abort.
 */
export const resolveAbortedTools =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'resolve_aborted_tools' }>;
    const { operation, transports } = host;
    // Message ownership (agentId / groupId / threadId / topicId) is resolved by
    // `settleAbortedToolRows`, which owns the row writes for every abort source.
    const events: AgentEvent[] = [];

    await transports.stream.publishEvent({
      data: {
        parentMessageId: payload.parentMessageId,
        phase: 'tools_aborted',
        toolsCalling: payload.toolsCalling,
      },
      stepIndex: operation.stepIndex,
      type: 'step_start',
    });

    const newState = structuredClone(state);

    const { messages } = await settleAbortedToolRows({
      existingToolMessageIds: payload.existingToolMessageIds,
      host,
      parentMessageId: payload.parentMessageId,
      state,
      toolsCalling: payload.toolsCalling,
    });
    newState.messages.push(...messages);

    newState.lastModified = new Date().toISOString();
    newState.status = 'done';

    await transports.stream.publishEvent({
      data: {
        finalState: newState,
        phase: 'execution_complete',
        reason: USER_ABORTED_REASON,
        reasonDetail: USER_ABORTED_REASON_DETAIL,
      },
      stepIndex: operation.stepIndex,
      type: 'step_complete',
    });

    events.push({
      finalState: newState,
      reason: USER_ABORTED_REASON,
      reasonDetail: USER_ABORTED_REASON_DETAIL,
      type: 'done',
    });

    return { events, newState };
  };
