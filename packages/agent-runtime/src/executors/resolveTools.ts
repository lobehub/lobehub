import type { AgentRuntimeHost, ToolRunResult } from '../transport';
import type {
  AgentEvent,
  AgentInstruction,
  AgentRuntimeContext,
  AgentState,
  InstructionExecutor,
} from '../types';

const BLOCKED_TOOL_CONTENT = 'Blocked by security/privacy.';
const BLOCKED_TOOL_ERROR = 'blocked_by_security_privacy';
const ABORTED_TOOL_CONTENT = 'Tool execution was aborted by user.';
const USER_ABORTED_REASON = 'user_aborted';
const USER_ABORTED_REASON_DETAIL = 'User aborted operation with pending tool calls';
const TOOL_MESSAGE_PERSIST_PHASE = 'tool_message_persist';

type RuntimeSessionWithEventCount = NonNullable<AgentRuntimeContext['session']> & {
  eventCount?: number;
};

const getErrorType = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return;

  const value = (error as { errorType?: unknown; name?: unknown; type?: unknown }).errorType;
  if (typeof value === 'string' || typeof value === 'number') return String(value);

  const type = (error as { type?: unknown }).type;
  if (typeof type === 'string' || typeof type === 'number') return String(type);

  const name = error instanceof Error ? error.name : undefined;
  return name || undefined;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return 'Unknown error';
};

const publishPersistError = async (host: AgentRuntimeHost, error: unknown) => {
  const { stepIndex } = host.operation;

  if (host.transports.stream.publishError) {
    await host.transports.stream.publishError({
      error,
      phase: TOOL_MESSAGE_PERSIST_PHASE,
      stepIndex,
    });
    return;
  }

  await host.transports.stream.publishEvent({
    data: {
      error: getErrorMessage(error),
      errorType: getErrorType(error),
      phase: TOOL_MESSAGE_PERSIST_PHASE,
    },
    stepIndex,
    type: 'error',
  });
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
    const events: AgentEvent[] = [];
    const newState = structuredClone(state);
    const toolResults: Array<{ data: ToolRunResult; toolCallId: string }> = [];
    const toolMessageIds: string[] = [];

    for (const toolPayload of payload.toolsCalling) {
      const result: ToolRunResult = {
        content: BLOCKED_TOOL_CONTENT,
        error: BLOCKED_TOOL_ERROR,
        executionTime: 0,
        state: { type: 'blocked' },
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

      try {
        const toolMessage = await transports.messages.createToolMessage({
          agentId: state.metadata!.agentId!,
          content: result.content,
          groupId: state.metadata?.groupId ?? undefined,
          metadata: { toolExecutionTimeMs: 0 },
          parentId: payload.parentMessageId,
          plugin: toolPayload as any,
          pluginError: result.error,
          pluginIntervention: {
            rejectedReason: BLOCKED_TOOL_ERROR,
            status: 'rejected',
          },
          pluginState: result.state,
          role: 'tool',
          threadId: state.metadata?.threadId,
          tool_call_id: toolPayload.id,
          topicId: state.metadata?.topicId,
        });
        toolMessageIds.push(toolMessage.id);
      } catch (error) {
        await publishPersistError(host, error);
        throw error;
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

    for (const toolPayload of payload.toolsCalling) {
      try {
        await transports.messages.createToolMessage({
          agentId: state.metadata!.agentId!,
          content: ABORTED_TOOL_CONTENT,
          groupId: state.metadata?.groupId ?? undefined,
          parentId: payload.parentMessageId,
          plugin: toolPayload as any,
          pluginIntervention: { status: 'aborted' },
          role: 'tool',
          threadId: state.metadata?.threadId,
          tool_call_id: toolPayload.id,
          topicId: state.metadata?.topicId,
        });
      } catch (error) {
        await publishPersistError(host, error);
        throw error;
      }

      newState.messages.push({
        content: ABORTED_TOOL_CONTENT,
        role: 'tool',
        tool_call_id: toolPayload.id,
      });
    }

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
