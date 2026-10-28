import { Tag } from '@lobehub/ui';
import { MessageSquareQuoteIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

import { TAG_MARGIN_INLINE_END } from '../constants';
import { usePinnedTopic } from './pinnedTopic';

export interface ReferTopicViewProps {
  fallbackTitle?: string;
  topicId: string;
}

export const ReferTopicView = memo<ReferTopicViewProps>(({ topicId, fallbackTitle }) => {
  const { t } = useTranslation('topic');
  const title = useChatStore(topicSelectors.getTopicById(topicId))?.title || fallbackTitle;
  const [switchTopic, openTopicInPortal] = useChatStore((s) => [
    s.switchTopic,
    s.openTopicInPortal,
  ]);
  const pinnedTopicId = usePinnedTopic();

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!topicId) return;
      // A surface bound to one topic must not be switched away from it: show
      // the referenced topic in the portal, which closes back onto that topic.
      if (pinnedTopicId) {
        if (topicId !== pinnedTopicId) openTopicInPortal(topicId);
        return;
      }
      switchTopic(topicId);
    },
    [openTopicInPortal, pinnedTopicId, switchTopic, topicId],
  );

  return (
    <span
      style={{
        cursor: topicId ? 'pointer' : 'default',
        display: 'inline-flex',
        marginInlineEnd: TAG_MARGIN_INLINE_END,
        userSelect: 'none',
      }}
      onClick={handleClick}
    >
      <Tag color="blue" icon={<MessageSquareQuoteIcon size={12} />} variant="borderless">
        {title || t('defaultTitle')}
      </Tag>
    </span>
  );
});

ReferTopicView.displayName = 'ReferTopicView';
