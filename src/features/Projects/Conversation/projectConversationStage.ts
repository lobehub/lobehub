/**
 * How much of the project conversation pane can render.
 *
 * - `loading`: the project or the conversation's agent is not known yet, so
 *   there is no workspace to frame. The whole pane waits.
 * - `agentPending`: the workspace stays mounted while a newly selected agent
 *   loads its config or reaches the chat store. Only the conversation waits.
 * - `ready`: the conversation renders.
 *
 * A topic switch must not drop back to `loading`: that unmounts the workspace,
 * so the header and composer blink out and the message list starts over. A
 * topic whose detail is still being fetched is `ready` too. Its readers update
 * when the row lands, and a send waits for the row (`useTopicDetailSendGuard`).
 */
export type ProjectConversationStage = 'agentPending' | 'loading' | 'ready';

export const projectConversationStage = (params: {
  agentConfigLoading: boolean;
  chatAgentId: string | undefined;
  conversationAgentId: string | undefined;
  hasProject: boolean;
}): ProjectConversationStage => {
  const { agentConfigLoading, chatAgentId, conversationAgentId, hasProject } = params;
  if (!hasProject || !conversationAgentId) return 'loading';
  if (agentConfigLoading || chatAgentId !== conversationAgentId) return 'agentPending';

  return 'ready';
};
