import { toast } from '@lobehub/ui/base-ui';
import { Split } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import { contextSelectors, useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';

export const branchingAction = defineAction({
  key: 'branching',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');

    const [topic, threadId] = useConversationStore((s) => [
      contextSelectors.topicId(s),
      contextSelectors.threadId(s),
    ]);
    const [startToForkThread, openThreadCreator] = useChatStore((s) => [
      s.startToForkThread,
      s.openThreadCreator,
    ]);
    // Conversation Provider context is the authority for the mounted surface.
    // Global active/portal ids describe another shell and may be cleared while a
    // portal-backed Thread provider remains mounted.
    const inThread = Boolean(ctx.data.threadId || threadId || startToForkThread);

    return useMemo(
      () =>
        inThread
          ? null
          : {
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
            },
      [t, ctx.id, inThread, topic, openThreadCreator],
    );
  },
});
