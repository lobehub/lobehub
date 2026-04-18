import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import FolderTag from './FolderTag';
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

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      {topicTitle && (
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
      )}
      <FolderTag />
    </Flexbox>
  );
});

export default TitleTags;
