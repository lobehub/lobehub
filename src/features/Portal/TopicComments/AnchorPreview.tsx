import type { TopicCommentItem } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { MessageSquareText } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';

import {
  highlightMessageWhenScrollSettles,
  isTopicCommentAnchorDeleted,
  resolveTopicCommentMessageLocation,
} from './messageLocator';
import { styles } from './styles';

const AnchorPreview = memo<{ comment: TopicCommentItem }>(({ comment }) => {
  const { t } = useTranslation('chat');
  const [messageIndex, messageElementId, scrollToIndex] = useChatStore((s) => {
    if (!s.activeAgentId || s.activeTopicId !== comment.topicId)
      return [-1, undefined, s.mainConversationScrollToIndex] as const;

    const location = resolveTopicCommentMessageLocation(
      displayMessageSelectors.mainDisplayChats(s),
      comment.messageId,
    );

    return [location?.index ?? -1, location?.elementId, s.mainConversationScrollToIndex] as const;
  });
  const canLocateMessage = messageIndex >= 0;
  const isDeleted = isTopicCommentAnchorDeleted(comment.messageId);

  const locateMessage = useCallback(() => {
    if (!messageElementId || !canLocateMessage || !scrollToIndex) return;
    requestAnimationFrame(() => {
      scrollToIndex(messageIndex, { align: 'center', smooth: true });
      highlightMessageWhenScrollSettles(messageElementId);
    });
  }, [canLocateMessage, messageElementId, messageIndex, scrollToIndex]);

  if (!comment.anchorPreview) return null;

  return (
    <Flexbox
      aria-disabled={canLocateMessage ? undefined : true}
      className={styles.anchor}
      gap={4}
      role={canLocateMessage ? 'button' : undefined}
      tabIndex={canLocateMessage ? 0 : undefined}
      onClick={locateMessage}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        locateMessage();
      }}
    >
      <Flexbox horizontal align={'center'} gap={6}>
        <Icon icon={MessageSquareText} size={14} />
        <Text fontSize={12} weight={500}>
          {t('topicComment.anchor')}
        </Text>
        {isDeleted && <Tag size={'small'}>{t('topicComment.anchorDeletedTag')}</Tag>}
      </Flexbox>
      <Text ellipsis={{ rows: 2 }} fontSize={12} type={'secondary'}>
        {comment.anchorPreview.excerpt || t('topicComment.anchorEmpty')}
      </Text>
    </Flexbox>
  );
});

AnchorPreview.displayName = 'TopicCommentAnchorPreview';

export default AnchorPreview;
