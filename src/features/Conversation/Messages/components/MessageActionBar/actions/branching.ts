import { toast } from '@lobehub/ui/base-ui';
import { Split } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { messageStateSelectors, useConversationStore } from '@/features/Conversation/store';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import { defineAction } from '../defineAction';

export const branchingAction = defineAction({
  key: 'branching',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');

    const topic = useChatStore((s) => s.activeTopicId);
    // Go through the Conversation store's `openThreadCreator` so the anchor is
    // resolved against this conversation's rows (see `dataSelectors.rowTailId`);
    // the raw ChatStore action would anchor on the row id — the chain head.
    const openThreadCreator = useConversationStore((s) => s.openThreadCreator);
    const forkCodexMessage = useConversationStore((s) => s.forkCodexMessage);
    const isInputLoading = useConversationStore(messageStateSelectors.isInputLoading);
    const sourceId = ctx.contentBlock?.id ?? ctx.data.children?.at(-1)?.id ?? ctx.id;
    // Match the persisted row used by forkCodexMessage, not a synthetic group header.
    const hasNativeForkTarget = useConversationStore((s) => {
      const metadata = s.dbMessages.find((message) => message.id === sourceId)?.metadata;
      return Boolean(metadata?.codexTurnId && metadata?.heteroSessionId);
    });
    const isPartialTurn = Boolean(
      ctx.contentBlock && ctx.data.children?.at(-1)?.id !== ctx.contentBlock.id,
    );
    const isCodex = useAgentStore(
      (s) => agentSelectors.currentAgentHeterogeneousProviderType(s) === 'codex',
    );

    return useMemo(
      () => ({
        disabled: isCodex && (isInputLoading || isPartialTurn || !hasNativeForkTarget),
        handleClick: async () => {
          if (!topic) {
            toast.warning(t('branchingRequiresSavedTopic'));
            return;
          }
          if (isCodex) {
            if (isInputLoading || isPartialTurn || !hasNativeForkTarget) return;
            try {
              await forkCodexMessage(sourceId);
            } catch (error) {
              toast.error(
                t('codexForkFailed', {
                  message: error instanceof Error ? error.message : String(error),
                }),
              );
            }
            return;
          }
          openThreadCreator(ctx.id);
        },
        icon: Split,
        key: 'branching',
        // Without native provenance (app-server off) the turn has no boundary; say why it is disabled.
        label: isCodex
          ? t(hasNativeForkTarget || isPartialTurn ? 'codexFork' : 'codexForkUnavailable')
          : t('branching'),
      }),
      [
        t,
        ctx.id,
        isCodex,
        topic,
        openThreadCreator,
        forkCodexMessage,
        isInputLoading,
        isPartialTurn,
        hasNativeForkTarget,
        sourceId,
      ],
    );
  },
});
