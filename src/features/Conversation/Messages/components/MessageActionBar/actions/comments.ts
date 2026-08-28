import { MessageCircle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useMessageCommentCount } from '@/features/TopicComment/hooks';
import { useChatStore } from '@/store/chat';

import { defineAction } from '../defineAction';

export const commentsAction = defineAction({
  key: 'comments',
  useBuild: (ctx) => {
    const { t } = useTranslation('chat');
    const { count, topicId } = useMessageCommentCount(ctx.id);
    const openTopicComments = useChatStore((s) => s.openTopicComments);
    const hasPersistedMessageId = ctx.data.role !== 'tasks' && ctx.data.role !== 'groupTasks';

    return useMemo(
      () =>
        hasPersistedMessageId && count === 0 && topicId
          ? {
              handleClick: () => openTopicComments(topicId, ctx.id),
              icon: MessageCircle,
              key: 'comments',
              label: t('topicComment.commentOnMessage'),
            }
          : null,
      [count, ctx.id, hasPersistedMessageId, openTopicComments, t, topicId],
    );
  },
});
