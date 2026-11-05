import { toast } from '@lobehub/ui';
import { Split } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation/store';
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

    return useMemo(
      () => ({
        handleClick: () => {
          if (!topic) {
            toast.warning(t('branchingRequiresSavedTopic'));
            return;
          }
          openThreadCreator(ctx.id);
        },
        icon: Split,
        key: 'branching',
        label: t('branching'),
      }),
      [t, ctx.id, topic, openThreadCreator],
    );
  },
});
