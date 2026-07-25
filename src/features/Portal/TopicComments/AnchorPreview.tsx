import type { TopicCommentItem } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { MessageSquareText } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';

import {
  highlightMessageWhenScrollSettles,
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
  const hasMessage = messageIndex >= 0;

  const locateMessage = useCallback(() => {
    if (!messageElementId || !hasMessage || !scrollToIndex) return;
    requestAnimationFrame(() => {
      scrollToIndex(messageIndex, { align: 'center', smooth: true });
      highlightMessageWhenScrollSettles(messageElementId);
    });
  }, [hasMessage, messageElementId, messageIndex, scrollToIndex]);

  if (!comment.anchorPreview) return null;

  return (
    <Flexbox
      aria-disabled={hasMessage ? undefined : true}
      className={styles.anchor}
      gap={4}
      role={hasMessage ? 'button' : undefined}
      tabIndex={hasMessage ? 0 : undefined}
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
          {hasMessage ? t('topicComment.anchor') : t('topicComment.anchorDeleted')}
        </Text>
      </Flexbox>
      <Text ellipsis={{ rows: 2 }} fontSize={12} type={'secondary'}>
        {comment.anchorPreview.excerpt || t('topicComment.anchorEmpty')}
      </Text>
    </Flexbox>
  );
});

AnchorPreview.displayName = 'TopicCommentAnchorPreview';

export default AnchorPreview;
