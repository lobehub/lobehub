import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import MemberCountTag from './MemberCountTag';

const TitleTags = memo(() => {
  const topicTitle = useChatStore((s) => topicSelectors.currentActiveTopic(s)?.title);
  const isGroupSession = useSessionStore(sessionSelectors.isCurrentSessionGroupSession);

  if (isGroupSession) {
    return (
      <Flexbox horizontal align={'center'} gap={12}>
        <MemberCountTag />
      </Flexbox>
    );
  }

  if (!topicTitle) return null;

  return (
    <Flexbox horizontal align={'center'} gap={4}>
      <span
        style={{
          fontSize: 14,
          marginLeft: 8,
          opacity: 0.6,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {topicTitle}
      </span>
    </Flexbox>
  );
});

export default TitleTags;
