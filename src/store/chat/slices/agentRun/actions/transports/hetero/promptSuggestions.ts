import { withPromptSuggestionArg } from '@lobechat/heterogeneous-agents';

import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { getAgentStoreState } from '@/store/agent/store';
import { followUpActionSelectors } from '@/store/followUpAction/selectors';
import { getFollowUpActionStoreState } from '@/store/followUpAction/store';
import { getUserStoreState } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/slices/settings/selectors/systemAgent';

type TurnMessages = ReadonlyArray<{ id: string; role: string }> | undefined;

const isFollowUpEnabled = (adapterType: string, agentId?: string | null): boolean =>
  adapterType === 'claude-code' &&
  !!agentId &&
  chatConfigByIdSelectors.getChatConfigById(agentId)(getAgentStoreState()).enableFollowUpChips ===
    true;

/** The reply is still loaded and the user has not sent the next message. */
const isLatestTurn = (messages: TurnMessages, assistantMessageId: string): boolean => {
  const index = messages?.findLastIndex((message) => message.id === assistantMessageId) ?? -1;
  if (!messages || index < 0) return false;
  return !messages.slice(index + 1).some((message) => message.role === 'user');
};

interface PreparePromptSuggestionsParams {
  adapterType: string;
  agentId?: string | null;
  args: string[] | undefined;
  conversationKey: string;
}

/**
 * Claude Code agents with Follow-up Suggestions on ask the CLI for its own.
 * Clears the previous turn's chip first: a drained queue skips the send hooks,
 * and a leftover chip would make this turn skip its extraction fallback.
 */
export const preparePromptSuggestions = ({
  adapterType,
  agentId,
  args,
  conversationKey,
}: PreparePromptSuggestionsParams): string[] | undefined => {
  if (!isFollowUpEnabled(adapterType, agentId)) return args;

  getFollowUpActionStoreState().clear(conversationKey);
  return withPromptSuggestionArg(args, true);
};

interface ApplyPromptSuggestionParams {
  assistantMessageId: string;
  conversationKey: string;
  messages: TurnMessages;
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
  if (!isLatestTurn(messages, assistantMessageId)) return;

  getFollowUpActionStoreState().setNativeSuggestion(conversationKey, {
    messageId: assistantMessageId,
    suggestion,
  });
};

interface FallBackToFollowUpExtractionParams {
  adapterType: string;
  agentId?: string | null;
  assistantMessageId: string;
  conversationKey: string;
  messages: TurnMessages;
  threadId?: string | null;
  topicId?: string | null;
}

/**
 * At run end, use server extraction when the CLI produced no suggestion: an
 * older CLI, a first turn, or a provider without suggestions. Any slot content
 * means this turn already has chips or a request in flight.
 */
export const fallBackToFollowUpExtraction = ({
  adapterType,
  agentId,
  assistantMessageId,
  conversationKey,
  messages,
  threadId,
  topicId,
}: FallBackToFollowUpExtractionParams): void => {
  if (!topicId || !isFollowUpEnabled(adapterType, agentId)) return;
  if (!isLatestTurn(messages, assistantMessageId)) return;

  const store = getFollowUpActionStoreState();
  if (followUpActionSelectors.slotStatus(conversationKey)(store) !== 'idle') return;

  const { enabled, model, provider } = systemAgentSelectors.followUpAction(getUserStoreState());
  if (!enabled || !model || !provider) return;

  void store.fetchFor(conversationKey, {
    hint: { kind: 'chat' },
    modelConfig: { model, provider },
    threadId: threadId ?? undefined,
    topicId,
  });
};
