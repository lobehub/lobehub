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
import ThreadSwitcher from './ThreadSwitcher';

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

  const fallbackTopicTitle = topicTitle || t('newTopic');
  const fallbackThreadTitle = threadTitle || t('thread.title', { ns: 'chat' });

  return (
    <Flexbox allowShrink horizontal align={'center'} gap={6} style={{ marginLeft: 8, minWidth: 0 }}>
      {activeThreadId ? (
        <>
          <span
            style={{
              color: cssVar.colorTextSecondary,
              flexShrink: 0,
              fontSize: 14,
              fontWeight: 500,
              maxWidth: 200,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {fallbackTopicTitle}
          </span>
          <span
            style={{
              color: cssVar.colorTextQuaternary,
              flexShrink: 0,
              fontSize: 14,
            }}
          >
            {'/'}
          </span>
          <ThreadSwitcher title={fallbackThreadTitle} />
        </>
      ) : (
        <>
          <span
            style={{
              color: cssVar.colorText,
              fontSize: 14,
              fontWeight: 600,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {fallbackTopicTitle}
          </span>
          <FolderTag />
        </>
      )}
    </Flexbox>
  );
});

export default TitleTags;
