import { withPromptSuggestionArg } from '@lobechat/heterogeneous-agents';

import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { getFollowUpActionStoreState } from '@/store/followUpAction/store';

interface ResolvePromptSuggestionArgsParams {
  adapterType: string;
  agentId?: string | null;
  args: string[] | undefined;
}

/** Claude Code agents with Follow-up Suggestions on ask the CLI for its own. */
export const resolvePromptSuggestionArgs = ({
  adapterType,
  agentId,
  args,
}: ResolvePromptSuggestionArgsParams): string[] | undefined => {
  if (adapterType !== 'claude-code' || !agentId) return args;

  const chatConfig = chatConfigByIdSelectors.getChatConfigById(agentId)(getAgentStoreState());
  return withPromptSuggestionArg(args, chatConfig.enableFollowUpChips === true);
};

interface ApplyPromptSuggestionParams {
  assistantMessageId: string;
  conversationKey: string;
  messages: ReadonlyArray<{ id: string; role: string }> | undefined;
  suggestion: string;
}

/**
 * Show the suggestion under the turn's final reply.
 *
 * It arrives after the input has unlocked, so the user may already have sent
 * the next message: a suggestion for an answered turn is dropped.
 */
export const applyPromptSuggestion = ({
  assistantMessageId,
  conversationKey,
  messages,
  suggestion,
}: ApplyPromptSuggestionParams): void => {
  const index = messages?.findLastIndex((message) => message.id === assistantMessageId) ?? -1;
  if (!messages || index < 0) return;
  if (messages.slice(index + 1).some((message) => message.role === 'user')) return;

  getFollowUpActionStoreState().setNativeSuggestion(conversationKey, {
    messageId: assistantMessageId,
    suggestion,
  });
};
