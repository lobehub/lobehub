import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useFetchActiveTopicDetail } from '@/hooks/useFetchActiveTopicDetail';
import { useFetchChatTopics } from '@/hooks/useFetchChatTopics';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import ShareButton from '@/routes/(main)/group/features/Conversation/Header/ShareButton';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';

export const MobileGroupHeader = () => {
  const { t } = useTranslation(['chat', 'topic']);
  const { gid } = useParams<{ gid: string }>();
  const router = useQueryRoute();
  const [open, setOpen] = useState(false);
  const title = useAgentGroupStore((s) => (gid ? s.groupMap[gid]?.title : undefined));
  const topic = useChatStore(topicSelectors.currentActiveTopic);
  const toggleMobileTopic = useGlobalStore((s) => s.toggleMobileTopic);

  useFetchChatTopics();
  useFetchActiveTopicDetail();

  return (
    <ChatHeader
      showBackButton
      right={<ShareButton mobile open={open} setOpen={setOpen} />}
      style={{ width: '100%' }}
      center={
        <ChatHeader.Title
          desc={
            <Flexbox horizontal align={'center'} gap={4}>
              <Text ellipsis style={{ maxWidth: '50vw' }}>
                {topic?.title || t('title', { ns: 'topic' })}
              </Text>
              <ActionIcon
                aria-label={t('title', { ns: 'topic' })}
                icon={ChevronDown}
                size={'small'}
                title={t('title', { ns: 'topic' })}
                onClick={() => toggleMobileTopic(true)}
              />
            </Flexbox>
          }
          title={
            <Text ellipsis style={{ maxWidth: '60vw' }}>
              {title || t('untitledGroup')}
            </Text>
          }
        />
      }
      onBackClick={() => router.push('/group', { replace: true })}
    />
  );
};
