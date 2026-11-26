'use client';

import { AGENT_SHARE_VISITOR_TOPIC_URL } from '@lobechat/const';
import { Center, Text } from '@lobehub/ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import ReadOnlyConversationSkeleton from '@/components/Skeleton/Conversation/ReadOnly';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { getLatestVisitorTopicId } from './latestVisitorTopic';
import { useShareVisitorTopicGroups } from './useShareVisitorTopics';

/**
 * Where the Share settings' 「View visitor conversations」 lands: opens the most recently active
 * visitor topic, with every visitor listed in the sidebar beside it.
 */
const ShareVisitorsLanding = () => {
  const { t } = useTranslation('topic');
  const { aid } = useParams<{ aid: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const { error, groups, isLoading, mutate } = useShareVisitorTopicGroups(aid);
  const latestTopicId = getLatestVisitorTopicId(groups);

  useEffect(() => {
    if (aid && latestTopicId)
      navigate(AGENT_SHARE_VISITOR_TOPIC_URL(aid, latestTopicId), { replace: true });
  }, [aid, latestTopicId, navigate]);

  if (isLoading || latestTopicId) return <ReadOnlyConversationSkeleton />;

  if (error) return <AsyncError error={error} variant={'page'} onRetry={() => void mutate()} />;

  return (
    <Center flex={1}>
      <Text type={'secondary'}>{t('shareVisitorTopics.empty')}</Text>
    </Center>
  );
};

export default ShareVisitorsLanding;
