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
      <Flexbox horizontal align={'center'} gap={12}>
        <MemberCountTag />
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <span
        style={{
          color: cssVar.colorText,
          fontSize: 14,
          fontWeight: 600,
          marginLeft: 8,
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
