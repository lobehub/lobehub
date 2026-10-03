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

    const [topic, openThreadCreator] = useChatStore((s) => [s.activeTopicId, s.openThreadCreator]);
    const forkCodexMessage = useConversationStore((s) => s.forkCodexMessage);
    const isInputLoading = useConversationStore(messageStateSelectors.isInputLoading);
    const sourceId = ctx.contentBlock?.id ?? ctx.data.children?.at(-1)?.id ?? ctx.id;
    const isPartialTurn = Boolean(
      ctx.contentBlock && ctx.data.children?.at(-1)?.id !== ctx.contentBlock.id,
    );
    const isCodex = useAgentStore(
      (s) => agentSelectors.currentAgentHeterogeneousProviderType(s) === 'codex',
    );

    return useMemo(
      () => ({
        disabled: isCodex && (isInputLoading || isPartialTurn),
        handleClick: async () => {
          if (!topic) {
            toast.warning(t('branchingRequiresSavedTopic'));
            return;
          }
          if (isCodex) {
            if (isInputLoading || isPartialTurn) return;
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
        label: isCodex ? t('codexFork') : t('branching'),
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
        sourceId,
      ],
    );
  },
});
