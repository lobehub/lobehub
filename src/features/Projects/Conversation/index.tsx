'use client';

import { Center, Flexbox, Text } from '@lobehub/ui';
import { memo, useCallback, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import NavHeader from '@/features/NavHeader';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import ChatConversation from '@/routes/(main)/agent/features/Conversation';
import ChatHydration from '@/routes/(main)/agent/features/Conversation/ChatHydration';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';

import { getProjectConversationPath } from '../Layout/navigation';

const ProjectConversation = memo(() => {
  const { t } = useTranslation('project');
  const { projectId, topicId } = useParams<{ projectId: string; topicId?: string }>();
  const detail = useCurrentProjectDetail(projectId);
  const detailSWR = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const coordinatorAgentId = detail?.project.coordinatorAgentId;
  const projectSlug = detail?.project.slug ?? projectId;
  const topicTitle = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.title : undefined,
  );

  useInitAgentConfig(coordinatorAgentId);

  useLayoutEffect(() => {
    if (!coordinatorAgentId) return;

    useAgentStore.setState(
      { activeAgentId: coordinatorAgentId },
      false,
      'ProjectConversation/syncAgentId',
    );
    useChatStore.setState(
      { activeAgentId: coordinatorAgentId },
      false,
      'ProjectConversation/syncAgentId',
    );
  }, [coordinatorAgentId]);

  const getConversationPath = useCallback(
    () => getProjectConversationPath(projectSlug!),
    [projectSlug],
  );
  const getTopicPath = useCallback(
    (_agentId: string, topicId: string) => getProjectConversationPath(projectSlug!, topicId),
    [projectSlug],
  );

  if (detailSWR.error) {
    return <AsyncError error={detailSWR.error} variant="page" onRetry={detailSWR.mutate} />;
  }
  if (detailSWR.isLoading || !coordinatorAgentId) {
    return (
      <Center height="100%" width="100%">
        <NeuralNetworkLoading />
      </Center>
    );
  }

  return (
    <Flexbox flex={1} height="100%" style={{ minHeight: 0, minWidth: 0 }}>
      <NavHeader
        left={
          <Text ellipsis weight={600}>
            {topicTitle || t('sidebar.newConversation')}
          </Text>
        }
      />
      <ChatHydration getConversationPath={getConversationPath} getTopicPath={getTopicPath} />
      <ChatConversation />
    </Flexbox>
  );
});

ProjectConversation.displayName = 'ProjectConversation';

export default ProjectConversation;
