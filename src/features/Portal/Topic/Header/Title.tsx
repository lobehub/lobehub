'use client';

import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useChatTopicById } from '@/store/chat/slices/topic/projection';

const Title = memo(() => {
  const { t } = useTranslation('topic');
  const topicId = useChatStore(chatPortalSelectors.portalTopicId);
  const title = useChatTopicById(topicId)?.title;

  return (
    <Text ellipsis style={{ fontSize: 14, fontWeight: 500 }}>
      {title || t('defaultTitle')}
    </Text>
  );
});

Title.displayName = 'PortalTopicTitle';

export default Title;
