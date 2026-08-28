import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { MessageCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

export const TopicCommentsTitle = memo(() => {
  const { t } = useTranslation('chat');
  const view = useChatStore(chatPortalSelectors.topicCommentsView);

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <Icon icon={MessageCircle} size={18} />
      <Text weight={500}>
        {view?.messageId ? t('topicComment.messageComments') : t('topicComment.title')}
      </Text>
    </Flexbox>
  );
});

export const TopicCommentThreadTitle = memo(() => {
  const { t } = useTranslation('chat');
  return <Text weight={500}>{t('topicComment.thread')}</Text>;
});
