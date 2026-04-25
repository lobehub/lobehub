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
  const { t } = useTranslation('topic');
  const topicTitle = useChatStore((s) => topicSelectors.currentActiveTopic(s)?.title);
  const isGroupSession = useSessionStore(sessionSelectors.isCurrentSessionGroupSession);

  if (isGroupSession) {
    return (
      <Flexbox allowShrink horizontal align={'center'} gap={12} style={{ minWidth: 0 }}>
        <MemberCountTag />
      </Flexbox>
    );
  }

  return (
    <Flexbox
      allowShrink
      horizontal
      align={'center'}
      gap={8}
      style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}
    >
      <span
        style={{
          color: cssVar.colorText,
          display: 'block',
          flex: '1 1 auto',
          fontSize: 14,
          fontWeight: 600,
          marginLeft: 8,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {topicTitle || t('newTopic')}
      </span>
      <FolderTag />
    </Flexbox>
  );
});

export default TitleTags;
