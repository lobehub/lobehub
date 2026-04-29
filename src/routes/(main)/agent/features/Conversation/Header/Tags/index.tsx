import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import FolderTag from './FolderTag';
import MemberCountTag from './MemberCountTag';

const TitleTags = memo(() => {
  const { t } = useTranslation(['topic', 'chat']);
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const threadTitle = useChatStore((s) =>
    s.activeThreadId && s.activeTopicId
      ? s.threadMaps[s.activeTopicId]?.find((thread) => thread.id === s.activeThreadId)?.title
      : undefined,
  );
  const topicTitle = useChatStore((s) => topicSelectors.currentActiveTopic(s)?.title);
  const isGroupSession = useSessionStore(sessionSelectors.isCurrentSessionGroupSession);

  if (isGroupSession) {
    return (
      <Flexbox allowShrink horizontal align={'center'} gap={12} style={{ minWidth: 0 }}>
        <MemberCountTag />
      </Flexbox>
    );
  }

  const displayTitle = activeThreadId
    ? threadTitle || t('thread.title', { ns: 'chat' })
    : topicTitle || t('newTopic');

  return (
    <Flexbox allowShrink horizontal align={'center'} gap={8}>
      <span
        style={{
          color: cssVar.colorText,
          fontSize: 14,
          fontWeight: 600,
          marginLeft: 8,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {displayTitle}
      </span>
      <FolderTag />
    </Flexbox>
  );
});

export default TitleTags;
