import { isDesktop } from '@lobechat/const';
import { type LobeAgentChatConfig } from '@lobechat/types';
import { useMemo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useFollowUpActionStore } from '@/store/followUpAction';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/slices/settings/selectors/systemAgent';

import { type ConversationHooks } from '../types';

interface UseChatFollowUpParams {
  agentChatConfig: LobeAgentChatConfig | undefined;
  /** Decides whether the agent's own CLI supplies the suggestions. */
  agentId?: string | null;
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
 * A Claude Code agent on desktop gets its suggestion from the CLI instead: no
 * global model is needed, no extraction runs, and only the clearing stays.
 *
 * Registration ordering note: callers MUST compose this hook LAST in a
 * `mergeConversationHooks(...)` chain. The hook's
 * `onBeforeSendMessage`/`onBeforeContinue`/`onBeforeRegenerate` clear the chip
 * slot; if a preceding validator returns `false`, the chain short-circuits
 * before the clear runs and chips persist for the blocked send.
 */
export const useChatFollowUp = ({
  agentChatConfig,
  agentId,
  conversationKey,
  threadId,
  topicId,
}: UseChatFollowUpParams): ConversationHooks => {
  const globalConfig = useUserStore(systemAgentSelectors.followUpAction);
  const isClaudeCodeAgent = useAgentStore(
    (s) =>
      !!agentId &&
      agentSelectors.getAgentConfigById(agentId)(s)?.agencyConfig?.heterogeneousProvider?.type ===
        'claude-code',
  );
  const usesNativeSuggestions =
    isDesktop && isClaudeCodeAgent && agentChatConfig?.enableFollowUpChips === true;

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
    if ((!effective && !usesNativeSuggestions) || !conversationKey || !topicId) return {};

    const clearSlot = () => useFollowUpActionStore.getState().clear(conversationKey);

    return {
      ...(!usesNativeSuggestions && {
        onAssistantTurnSettled: async (_messageId, { reason }) => {
          if (reason === 'stopped') return;
          await useFollowUpActionStore.getState().fetchFor(conversationKey, {
            hint: { kind: 'chat' },
            modelConfig: { model: globalConfig.model, provider: globalConfig.provider },
            threadId,
            topicId,
          });
        },
      }),
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
  }, [
    effective,
    usesNativeSuggestions,
    conversationKey,
    globalConfig.model,
    globalConfig.provider,
    threadId,
    topicId,
  ]);
};
