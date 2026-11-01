import type { ChatToolPayload } from '@lobechat/types';

import type { AgentRuntimeHost, ToolRunResult } from '../transport';
import type { AgentState } from '../types';

const TOOL_MESSAGE_PERSIST_PHASE = 'tool_message_persist';

const persistFatalErrors = new WeakSet<object>();

const markPersistFatal = <T>(error: T): T => {
  if (error && typeof error === 'object') persistFatalErrors.add(error);
  return error;
};

export const isPersistFatal = (error: unknown) =>
  !!error && typeof error === 'object' && persistFatalErrors.has(error);

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

// Execution-entry denial is free; withholding an already executed result is not.
export const isBlockedBeforeExecution = (result: ToolRunResult) =>
  result.state?.type === 'blocked' && result.state.phase !== 'afterToolCall';

export const toolResultMetadata = (result: ToolRunResult) => ({
  toolExecutionTimeMs: result.executionTime ?? 0,
  toolResultStop: result.stop ?? false,
  toolResultSuccess: result.success,
  ...(result.workRegistration && { toolWorkRegistration: result.workRegistration }),
});

export const persistToolResultMetadata = async (
  host: AgentRuntimeHost,
  toolMessageId: string,
  result: ToolRunResult,
) => {
  try {
    await host.transports.messages.updateToolMessage(toolMessageId, {
      metadata: toolResultMetadata(result),
    });
  } catch (error) {
    await publishError(host, error, TOOL_MESSAGE_PERSIST_PHASE);
    throw markPersistFatal(error);
  }
};

export const publishError = async (host: AgentRuntimeHost, error: unknown, phase: string) => {
  const { stepIndex } = host.operation;

  if (host.transports.stream.publishError) {
    await host.transports.stream.publishError({ error, phase, stepIndex });
    return;
  }

  await host.transports.stream.publishEvent({
    data: {
      error: getErrorMessage(error),
      errorType: getErrorType(error),
      phase,
    },
    stepIndex,
    type: 'error',
  });
};

export const createToolMessage = async ({
  host,
  parentMessageId,
  result,
  resultBlocked,
  state,
  tool,
}: {
  host: AgentRuntimeHost;
  parentMessageId: string;
  result: ToolRunResult;
  resultBlocked?: boolean;
  state: AgentState;
  tool: ChatToolPayload;
}) => {
  try {
    const agentId = host.operation.agentId ?? state.origin?.agentId;
    if (!agentId) {
      throw new Error(
        `[call_tool] Missing agentId for tool message (op=${host.operation.operationId})`,
      );
    }

    return await host.transports.messages.createToolMessage({
      agentId,
      content: result.content,
      groupId: host.operation.groupId ?? state.origin?.groupId ?? undefined,
      metadata: toolResultMetadata(result),
      parentId: parentMessageId,
      plugin: tool as any,
      pluginError: result.error ?? null,
      ...((isBlockedBeforeExecution(result) || resultBlocked) && {
        pluginIntervention: { rejectedReason: result.state?.reason, status: 'rejected' },
      }),
      pluginState: result.state,
      role: 'tool',
      threadId: host.operation.threadId ?? state.origin?.threadId,
      tool_call_id: tool.id,
      topicId: host.operation.topicId ?? state.origin?.topicId,
    });
  } catch (error) {
    await publishError(host, error, TOOL_MESSAGE_PERSIST_PHASE);
    throw markPersistFatal(error);
  }
};

export const updateExistingToolMessage = async ({
  host,
  result,
  resultBlocked,
  toolMessageId,
}: {
  host: AgentRuntimeHost;
  result: ToolRunResult;
  resultBlocked?: boolean;
  toolMessageId: string;
}) => {
  try {
    await host.transports.messages.updateToolMessage(toolMessageId, {
      content: result.content,
      metadata: toolResultMetadata(result),
      pluginError: result.error ?? null,
      pluginState: result.state ?? {},
      replacePluginState: true,
    });
    if (isBlockedBeforeExecution(result) || resultBlocked) {
      await host.transports.messages.updateToolIntervention(toolMessageId, {
        rejectedReason: result.state?.reason,
        status: 'rejected',
      });
    }
  } catch (error) {
    await publishError(host, error, TOOL_MESSAGE_PERSIST_PHASE);
    throw markPersistFatal(error);
  }
};
