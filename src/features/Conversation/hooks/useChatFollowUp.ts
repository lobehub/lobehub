import { type LobeAgentChatConfig } from '@lobechat/types';
import { useMemo } from 'react';

import { useFollowUpActionStore } from '@/store/followUpAction';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/slices/settings/selectors/systemAgent';

import { type ConversationHooks } from '../types';

interface UseChatFollowUpParams {
  agentChatConfig: LobeAgentChatConfig | undefined;
  conversationKey: string | undefined;
  threadId?: string;
  topicId: string | undefined;
}

/**
 * Wire the chat-side Follow-up Chips lifecycle.
 *
 * Effective enable = `systemAgent.followUpAction.enabled` AND a valid global
 * model/provider AND per-agent `chatConfig.enableFollowUpChips` — otherwise
 * returns an empty `ConversationHooks` object so the merge chain treats it as
 * identity.
 *
 * Registration ordering note: callers MUST compose this hook LAST in a
 * `mergeConversationHooks(...)` chain. The hook's
 * `onBeforeSendMessage`/`onBeforeContinue`/`onBeforeRegenerate` clear the chip
 * slot; if a preceding validator returns `false`, the chain short-circuits
 * before the clear runs and chips persist for the blocked send.
 */
export const useChatFollowUp = ({
  agentChatConfig,
  conversationKey,
  threadId,
  topicId,
}: UseChatFollowUpParams): ConversationHooks => {
  const globalConfig = useUserStore(systemAgentSelectors.followUpAction);

  const effective = useMemo(() => {
    const globalEnabled = globalConfig.enabled === true;
    const hasValidModel = !!globalConfig.model && !!globalConfig.provider;
    const perAgentEnabled = agentChatConfig?.enableFollowUpChips === true;
    return globalEnabled && hasValidModel && perAgentEnabled;
  }, [
    globalConfig.enabled,
    globalConfig.model,
    globalConfig.provider,
    agentChatConfig?.enableFollowUpChips,
  ]);

  return useMemo<ConversationHooks>(() => {
    if (!effective || !conversationKey || !topicId) return {};

    const clearSlot = () => useFollowUpActionStore.getState().clear(conversationKey);

    return {
      onAssistantTurnSettled: async (_messageId, { reason }) => {
        if (reason === 'stopped') return;
        await useFollowUpActionStore.getState().fetchFor(conversationKey, {
          hint: { kind: 'chat' },
          modelConfig: { model: globalConfig.model, provider: globalConfig.provider },
          threadId,
          topicId,
        });
      },
      onBeforeContinue: async () => {
        clearSlot();
      },
      onBeforeRegenerate: async () => {
        clearSlot();
      },
      onBeforeSendMessage: async () => {
        clearSlot();
      },
    };
  }, [effective, conversationKey, globalConfig.model, globalConfig.provider, threadId, topicId]);
};
