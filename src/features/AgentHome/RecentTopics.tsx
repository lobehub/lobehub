'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { BotMessageSquareIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import useSWR from 'swr';

import { SESSION_CHAT_TOPIC_URL } from '@/const/url';
import { topicService } from '@/services/topic';

import SectionHeader from './SectionHeader';

const AgentRecentTopics = memo(() => {
  const { t } = useTranslation('chat');
  const { aid } = useParams<{ aid: string }>();

  const { data: result, isLoading } = useSWR(aid ? ['agentHome.topics', aid] : null, () =>
    topicService.getTopics({ agentId: aid!, current: 0, pageSize: 10 }),
  );

  const topics = result?.items;

  if (isLoading || !topics || topics.length === 0) return null;

  return (
    <Flexbox gap={16}>
      <SectionHeader
        actionLabel={t('topic.viewAll')}
        actionUrl={`/agent/${aid}`}
        icon={BotMessageSquareIcon}
        title={t('topic.recent')}
      />
      <Flexbox horizontal gap={12} style={{ overflowX: 'auto', paddingBottom: 4 }}>
        {topics.map((topic) => (
          <Link
            key={topic.id}
            style={{ color: 'inherit', flexShrink: 0, textDecoration: 'none' }}
            to={SESSION_CHAT_TOPIC_URL(aid!, topic.id)}
          >
            <Block
              clickable
              flex={'none'}
              height={80}
              variant={'outlined'}
              width={180}
              style={{
                borderRadius: cssVar.borderRadiusLG,
                overflow: 'hidden',
              }}
            >
              <Flexbox gap={4} height={'100%'} justify={'center'} padding={12}>
                <Text ellipsis weight={500}>
                  {topic.title || t('topic.defaultTitle')}
                </Text>
                <Text ellipsis fontSize={12} type={'secondary'}>
                  {topic.updatedAt ? new Date(topic.updatedAt).toLocaleDateString() : ''}
                </Text>
              </Flexbox>
            </Block>
          </Link>
        ))}
      </Flexbox>
    </Flexbox>
  );
});

export default AgentRecentTopics;
