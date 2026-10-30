import type { ToolCallPayload } from '../types';
import type { FinalizedSubagentRunSnapshot, SubagentRunSnapshot } from './types';

/**
 * A persisted message as a thread query returns it, narrowed to the fields
 * subagent rehydration reads. Both the server's DB rows and the renderer's
 * `UIChatMessage`s fit this shape.
 */
export interface SubagentThreadMessage {
  content?: string | null;
  id: string;
  metadata?: Record<string, any> | null;
  reasoning?: { content?: string } | null;
  role: string;
  threadId?: string | null;
  tool_call_id?: string | null;
  tools?: (ToolCallPayload & { result_msg_id?: string })[] | null;
}

/** Adapter turn id persisted on an in-thread assistant (`heteroMessageId` carries the same id). */
const turnIdOf = (message: SubagentThreadMessage): string | undefined => {
  const turnId = message.metadata?.subagentMessageId ?? message.metadata?.heteroMessageId;
  return typeof turnId === 'string' ? turnId : undefined;
};

const turnIdsOf = (messages: SubagentThreadMessage[]): string[] =>
  messages
    .filter((m) => m.role === 'assistant')
    .map(turnIdOf)
    .filter((id): id is string => !!id);

/**
 * Rebuild the snapshot of an in-flight subagent run from its thread's messages
 * (ordered `createdAt` asc). A thread query also returns the parent rows the
 * thread was forked from, so only rows of `threadId` count.
 *
 * Returns undefined when the thread has no assistant yet — there is nothing to
 * attach a continuation turn to, and the first-event path seeds it.
 */
export const buildSubagentRunSnapshot = (
  parentToolCallId: string,
  threadId: string,
  allMessages: SubagentThreadMessage[],
): SubagentRunSnapshot | undefined => {
  const messages = allMessages.filter((m) => m.threadId === threadId);
  const currentAssistant = messages.findLast((m) => m.role === 'assistant');
  if (!currentAssistant) return undefined;

  const toolMessageIdByCallId = new Map(
    messages.filter((m) => m.role === 'tool' && m.tool_call_id).map((m) => [m.tool_call_id!, m.id]),
  );
  const turnTools = (currentAssistant.tools ?? []).flatMap((tool) => {
    const toolMessageId = tool.result_msg_id ?? toolMessageIdByCallId.get(tool.id);
    if (!toolMessageId) return [];
    const payload: ToolCallPayload = {
      apiName: tool.apiName,
      arguments: tool.arguments,
      id: tool.id,
      identifier: tool.identifier,
      type: tool.type,
    };
    return [{ payload, toolMessageId }];
  });

  return {
    accContent: currentAssistant.content || undefined,
    accReasoning: currentAssistant.reasoning?.content || undefined,
    currentAssistantId: currentAssistant.id,
    // The in-flight turn's CC message.id, so a continuation event is the SAME
    // turn (no spurious boundary → no fragmentation).
    currentSubagentMessageId: turnIdOf(currentAssistant),
    // Chain rule: the next turn's assistant parents off the prior assistant
    // (the spine), not its last child tool.
    lastChainParentId: currentAssistant.id,
    lifetimeToolCallIds: [...toolMessageIdByCallId.keys()],
    parentToolCallId,
    threadId,
    turnIds: turnIdsOf(messages),
    turnTools,
  };
};

/**
 * Resume anchor of a finalized thread: its newest non-tool row (normally the
 * hand-back answer), the turns it already holds, and its inner tool ids.
 */
export const buildFinalizedSubagentRunSnapshot = (
  parentToolCallId: string,
  threadId: string,
  allMessages: SubagentThreadMessage[],
): FinalizedSubagentRunSnapshot | undefined => {
  const messages = allMessages.filter((m) => m.threadId === threadId);
  const tail = messages.findLast((m) => m.role !== 'tool');
  if (!tail) return undefined;

  return {
    lastChainParentId: tail.id,
    lifetimeToolCallIds: messages
      .filter((m) => m.role === 'tool' && m.tool_call_id)
      .map((m) => m.tool_call_id!),
    parentToolCallId,
    threadId,
    turnIds: turnIdsOf(messages),
  };
};
