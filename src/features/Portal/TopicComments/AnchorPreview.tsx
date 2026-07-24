import type { TopicCommentItem } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { MessageSquareText } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { styles } from './styles';

const MESSAGE_HIGHLIGHT_ATTRIBUTE = 'data-message-locate-highlight';
const MESSAGE_HIGHLIGHT_DURATION_MS = 1400;
const MESSAGE_HIGHLIGHT_MAX_FRAMES = 240;
const MESSAGE_HIGHLIGHT_POSITION_EPSILON = 0.5;
const MESSAGE_HIGHLIGHT_SETTLE_MS = 150;
let messageHighlightSequence = 0;

const highlightMessageWhenScrollSettles = (messageId: string) => {
  const sequence = ++messageHighlightSequence;
  let remainingFrames = MESSAGE_HIGHLIGHT_MAX_FRAMES;
  let lastMessageElement: HTMLElement | undefined;
  let lastTop: number | undefined;
  let stableSince: number | undefined;

  document
    .querySelectorAll<HTMLElement>(`[${MESSAGE_HIGHLIGHT_ATTRIBUTE}]`)
    .forEach((element) => element.removeAttribute(MESSAGE_HIGHLIGHT_ATTRIBUTE));

  const waitForScrollEnd = (timestamp: number) => {
    if (sequence !== messageHighlightSequence) return;

    const messageElement = Array.from(
      document.querySelectorAll<HTMLElement>('[data-message-id]'),
    ).find((element) => element.dataset.messageId === messageId);

    if (!messageElement) {
      if (remainingFrames-- > 0) requestAnimationFrame(waitForScrollEnd);
      return;
    }

    const top = messageElement.getBoundingClientRect().top;
    if (messageElement !== lastMessageElement || lastTop === undefined) {
      lastMessageElement = messageElement;
      stableSince = undefined;
    } else if (Math.abs(top - lastTop) <= MESSAGE_HIGHLIGHT_POSITION_EPSILON) {
      stableSince ??= timestamp;
    } else {
      stableSince = undefined;
    }
    lastTop = top;

    const hasSettled =
      stableSince !== undefined && timestamp - stableSince >= MESSAGE_HIGHLIGHT_SETTLE_MS;
    if (!hasSettled) {
      if (remainingFrames-- > 0) requestAnimationFrame(waitForScrollEnd);
      return;
    }

    const sequenceValue = String(sequence);
    messageElement.removeAttribute(MESSAGE_HIGHLIGHT_ATTRIBUTE);
    void messageElement.offsetWidth;
    messageElement.setAttribute(MESSAGE_HIGHLIGHT_ATTRIBUTE, sequenceValue);

    window.setTimeout(() => {
      if (messageElement.getAttribute(MESSAGE_HIGHLIGHT_ATTRIBUTE) === sequenceValue) {
        messageElement.removeAttribute(MESSAGE_HIGHLIGHT_ATTRIBUTE);
      }
    }, MESSAGE_HIGHLIGHT_DURATION_MS);
  };

  requestAnimationFrame(waitForScrollEnd);
};

const AnchorPreview = memo<{ comment: TopicCommentItem }>(({ comment }) => {
  const { t } = useTranslation('chat');
  const [messageIndex, messageElementId, scrollToIndex] = useChatStore((s) => {
    if (!s.activeAgentId || s.activeTopicId !== comment.topicId)
      return [-1, undefined, s.mainConversationScrollToIndex] as const;

    const messages = (
      s.messagesMap[
        messageMapKey({
          agentId: s.activeAgentId,
          groupId: s.activeGroupId,
          topicId: s.activeTopicId,
        })
      ] ?? []
    ).filter(({ threadId }) => !threadId);
    const index = messages.findIndex(
      ({ id, tasks }) =>
        id === comment.messageId || tasks?.some((task) => task.id === comment.messageId),
    );

    return [
      index,
      index >= 0 ? messages[index].id : undefined,
      s.mainConversationScrollToIndex,
    ] as const;
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
