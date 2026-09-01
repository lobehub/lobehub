import type { ChatToolPayload } from '@lobechat/types';

import type { AgentRuntimeHost } from '../transport';
import type { AgentState } from '../types';

export const ABORTED_TOOL_CONTENT = 'Tool execution was aborted by user.';

const TOOL_MESSAGE_PERSIST_PHASE = 'tool_message_persist';

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

export const publishPersistError = async (host: AgentRuntimeHost, error: unknown) => {
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

/**
 * Close out tool calls that will never produce a result.
 *
 * Every `tool_call_id` the assistant asked for must end up with exactly one
 * tool row. The assistant message is already persisted, so a call left without
 * one puts the conversation in a shape no provider accepts on the next
 * `call_llm` — and, before that, leaves an approval card that outlives the Stop
 * meant to clear it.
 *
 * Shared by the two moments that produce such calls: `resolve_aborted_tools`
 * (calls that never started — fresh off the LLM stream, or parked pending
 * approval) and the tool executors themselves (calls that were mid-flight when
 * an abort landed, which settle inline rather than deferring to another step).
 */
export const settleAbortedToolRows = async ({
  existingToolMessageIds,
  host,
  parentMessageId,
  state,
  toolsCalling,
}: {
  existingToolMessageIds?: Record<string, string>;
  host: AgentRuntimeHost;
  parentMessageId: string;
  state: AgentState;
  toolsCalling: ChatToolPayload[];
}): Promise<{
  /** `tool_call_id → the row that now holds its aborted result`. */
  messageIds: Record<string, string>;
  /** Tool messages to append to `state.messages`, in call order. */
  messages: Array<{ content: string; id: string; role: 'tool'; tool_call_id: string }>;
}> => {
  const { operation, transports } = host;
  const agentId = operation.agentId ?? state.metadata?.agentId;
  const groupId = operation.groupId ?? state.metadata?.groupId;
  const threadId = operation.threadId ?? state.metadata?.threadId;
  const topicId = operation.topicId ?? state.metadata?.topicId;

  if (!agentId) {
    throw new Error(
      `[settleAbortedToolRows] Missing agentId for tool messages (op=${operation.operationId})`,
    );
  }

  const messageIds: Record<string, string> = {};
  const messages: Array<{ content: string; id: string; role: 'tool'; tool_call_id: string }> = [];

  for (const toolPayload of toolsCalling) {
    // Prefer an ID carried by the approval resume: its `parentMessageId` is the
    // tool row itself, so using it as lookup scope would miss the row's real
    // assistant parent. Other paths cannot reliably know whether a row exists,
    // so the scoped indexed read keeps the invariant for them.
    const existingMessageId =
      existingToolMessageIds?.[toolPayload.id] ??
      (await transports.messages.findToolMessageIdByToolCallId(toolPayload.id, parentMessageId));
    try {
      if (existingMessageId) {
        // Settle THAT row: inserting a second one would duplicate the tool in
        // the turn and leave the original `pending`, so the approval card
        // outlives the Stop that was supposed to clear it.
        await transports.messages.updateToolMessage(existingMessageId, {
          content: ABORTED_TOOL_CONTENT,
        });
        await transports.messages.updateToolIntervention(existingMessageId, {
          status: 'aborted',
        });
        messageIds[toolPayload.id] = existingMessageId;
      } else {
        const created = await transports.messages.createToolMessage({
          agentId,
          content: ABORTED_TOOL_CONTENT,
          groupId,
          parentId: parentMessageId,
          plugin: toolPayload as any,
          pluginIntervention: { status: 'aborted' },
          role: 'tool',
          threadId,
          tool_call_id: toolPayload.id,
          topicId,
        });
        messageIds[toolPayload.id] = created.id;
      }
    } catch (error) {
      await publishPersistError(host, error);
      throw error;
    }

    /** Keep the persisted id even though aborted operations normally stop here. */
    messages.push({
      content: ABORTED_TOOL_CONTENT,
      id: messageIds[toolPayload.id],
      role: 'tool',
      tool_call_id: toolPayload.id,
    });
  }

  return { messageIds, messages };
};
