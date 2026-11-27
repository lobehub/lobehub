import type { ChatToolPayload } from '@lobechat/types';

import type { AgentRuntimeHost, QueryMessagesInput, QueryMessagesOptions } from '../transport';
import type { AgentState } from '../types';

type StateMessages = AgentState['messages'];

/**
 * The in-memory row for a tool result this step persisted. Keeps the durable
 * id: the next gateway step rebuilds media refs by message id before its DB
 * rehydrate, and an id-less tool result makes that safety gate keep the stale
 * snapshot instead.
 */
export const toToolStateMessage = (
  result: { content: string; state?: any },
  tool: ChatToolPayload,
  toolMessageId: string,
) => ({
  content: result.content,
  id: toolMessageId,
  plugin: tool,
  pluginState: result.state,
  role: 'tool',
  tool_call_id: tool.id,
});

/** Re-read the run's conversation scope, picking only the scope fields. */
export const queryScopeMessages = (
  host: AgentRuntimeHost,
  scope: Pick<QueryMessagesInput, 'agentId' | 'groupId' | 'threadId' | 'topicId'> | undefined,
  options?: QueryMessagesOptions,
) => {
  const params = {
    agentId: scope?.agentId,
    groupId: scope?.groupId,
    threadId: scope?.threadId,
    topicId: scope?.topicId,
  };
  return options
    ? host.transports.messages.query(params, options)
    : host.transports.messages.query(params);
};

/**
 * Bring `newState.messages` up to date after tool calls persisted `rows`.
 *
 * `requery` re-reads the conversation from the transport. It is skipped — and
 * the rows patched in place (replacing a row with the same id, else appended) —
 * when there is nothing to re-read (`requery` omitted) or when the host re-reads
 * the conversation at the next step entry anyway
 * (`MessageTransport.rehydratesOnNextStep`): on the server that re-read was a
 * second full-topic query per tool step whose result the entry read discards.
 * Rows other writers added meanwhile (deferred placeholders, a group member's
 * reply) arrive with that entry read.
 */
export const refreshToolStateMessages = async (
  host: AgentRuntimeHost,
  state: AgentState,
  newState: AgentState,
  rows: StateMessages,
  requery?: () => Promise<StateMessages>,
): Promise<void> => {
  if (requery && host.transports.messages.rehydratesOnNextStep?.(state) !== true) {
    newState.messages = await requery();
    return;
  }

  for (const row of rows) {
    const index = newState.messages.findIndex((message) => message.id === row.id);
    if (index >= 0) newState.messages[index] = row;
    else newState.messages.push(row);
  }
};
