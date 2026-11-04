import type { State as ConversationState } from '@/features/Conversation/store/initialState';
import { dataSelectors } from '@/features/Conversation/store/slices/data/selectors';

/**
 * The agent a tool result's view acts as: the one whose message carries the
 * result. In a group conversation that is the member who ran the tool, not the
 * conversation's own agent (the supervisor), so its connectors, approval rules
 * and calls resolve as that member's runs do.
 */
export const mcpAppAgentIdSelector =
  (messageId: string | undefined) =>
  (s: ConversationState): string | undefined =>
    (messageId ? dataSelectors.getDbMessageById(messageId)(s)?.agentId : undefined) ||
    s.context.agentId ||
    undefined;
