import { toast } from '@lobehub/ui/base-ui';
import { GitFork } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { defineAction } from '../defineAction';

/**
 * Fork the conversation up to this message into a separate new topic.
 *
 * Assistant-only: the fork copies a conversation prefix, so the anchor has to
 * be a reply that already has context behind it. `group` is the aggregated
 * form of the same reply (several assistant blocks rendered as one turn), so it
 * gets the entry too. This is deliberately separate from `branching` — that one
 * opens a thread *inside* the current topic, while this one produces a
 * standalone topic in the sidebar.
 */
export const forkAction = defineAction({
  key: 'fork',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');

    const [topic, forkTopic] = useChatStore((s) => [s.activeTopicId, s.forkTopic]);
    const isAssistant = ctx.role === 'assistant' || ctx.role === 'group';

    return useMemo(
      () =>
        isAssistant
          ? {
              handleClick: async () => {
                if (!topic) {
                  toast.warning(t('forkRequiresSavedTopic'));
                  return;
                }

                await forkTopic(ctx.id);
              },
              icon: GitFork,
              key: 'fork',
              label: t('forkTopic'),
            }
          : null,
      [isAssistant, t, ctx.id, topic, forkTopic],
    );
  },
});
