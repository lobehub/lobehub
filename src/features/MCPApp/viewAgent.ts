import type { State as ConversationState } from '@/features/Conversation/store/initialState';

interface MessageNode {
  agentId?: string | null;
  children?: MessageNode[];
  compressedMessages?: MessageNode[];
  id: string;
  tools?: { result?: { id?: string } | null; result_msg_id?: string }[] | null;
}

const holdsResult = (node: MessageNode, messageId: string) =>
  node.id === messageId ||
  !!node.tools?.some((tool) => tool.result_msg_id === messageId || tool.result?.id === messageId);

/**
 * The message that carries a tool result: its own row, or, once the turn is
 * compressed, the parsed assistant group inside the compressed history whose
 * tool calls hold it (one agent's run each).
 */
const findProducer = (nodes: MessageNode[], messageId: string): MessageNode | undefined => {
  for (const node of nodes) {
    if (holdsResult(node, messageId)) return node;
    if (node.children?.some((child) => holdsResult(child, messageId))) return node;
    const nested = node.compressedMessages && findProducer(node.compressedMessages, messageId);
    if (nested) return nested;
  }
  return undefined;
};

/**
 * The agent a tool result's view acts as: the one whose message carries the
 * result. In a group conversation that is the member who ran the tool, not the
 * conversation's own agent (the supervisor), so its connectors, approval rules
 * and calls resolve as that member's runs do.
 */
export const mcpAppAgentIdSelector =
  (messageId: string | undefined) =>
  (s: ConversationState): string | undefined =>
    (messageId
      ? findProducer(s.dbMessages as unknown as MessageNode[], messageId)?.agentId
      : undefined) ||
    s.context.agentId ||
    undefined;
