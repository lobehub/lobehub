'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo, useCallback, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import TopicActions from '@/features/AgentSidebar/Topic/List/Item/Actions';
import ConversationWorkspace from '@/features/Conversation/Workspace';
import NavHeader from '@/features/NavHeader';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import ChatConversation from '@/routes/(main)/agent/features/Conversation';
import ChatHydration from '@/routes/(main)/agent/features/Conversation/ChatHydration';
import TerminalPanelToggle from '@/routes/(main)/agent/features/Conversation/Header/TerminalPanelToggle';
import WorkingPanelToggle from '@/routes/(main)/agent/features/Conversation/Header/WorkingPanelToggle';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { getProjectConversationPath } from '../Layout/navigation';

const ProjectConversation = memo(() => {
  const { t } = useTranslation('project');
  const { projectId, topicId } = useParams<{ projectId: string; topicId?: string }>();
  const detail = useCurrentProjectDetail(projectId);
  const detailSWR = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const topics = useProjectDirectoryStore((s) => s.useFetchProjectTopics)(detail?.project.id);
  const selectedTopic = topics.data?.data.find((topic) => topic.id === topicId);
  const conversationAgentId = topicId
    ? (selectedTopic?.agentId ?? undefined)
    : detail?.project.coordinatorAgentId;
  const projectSlug = detail?.project.slug ?? projectId;
  const topicTitle = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.title : undefined,
  );

  const agent = useInitAgentConfig(conversationAgentId);
  const topicDetail = useChatStore((s) => s.useFetchTopicDetail)(selectedTopic?.id);
  const activeAgentId = useChatStore((s) => s.activeAgentId);

  useLayoutEffect(() => {
    if (!conversationAgentId) return;

    useAgentStore.setState(
      { activeAgentId: conversationAgentId },
      false,
      'ProjectConversation/syncAgentId',
    );
    useChatStore.setState(
      { activeAgentId: conversationAgentId },
      false,
      'ProjectConversation/syncAgentId',
    );
  }, [conversationAgentId]);

  const getConversationPath = useCallback(
    () => getProjectConversationPath(projectSlug!),
    [projectSlug],
  );
  const getTopicPath = useCallback(
    (_agentId: string, topicId: string) => getProjectConversationPath(projectSlug!, topicId),
    [projectSlug],
  );

  if (topicDetail.error)
    return <AsyncError error={topicDetail.error} variant="page" onRetry={topicDetail.mutate} />;
  if (agent.error) return <AsyncError error={agent.error} variant="page" onRetry={agent.mutate} />;
  if (topics.error)
    return <AsyncError error={topics.error} variant="page" onRetry={topics.mutate} />;
  if (!topicId)
    return (
      <Center height="100%">
        <Text>{t('topics.chooseTopic')}</Text>
      </Center>
    );
  if (topics.data && !selectedTopic)
    return (
      <Center height="100%">
        <Text>{t('topics.notFound')}</Text>
      </Center>
    );
  if (detailSWR.error) {
    return <AsyncError error={detailSWR.error} variant="page" onRetry={detailSWR.mutate} />;
  }
  if (
    detailSWR.isLoading ||
    !conversationAgentId ||
    agent.isLoading ||
    topicDetail.isLoading ||
    activeAgentId !== conversationAgentId
  ) {
    return (
      <Center height="100%" width="100%">
        <NeuralNetworkLoading />
      </Center>
    );
  }

  return (
    <ConversationWorkspace
      header={
        <NavHeader
          left={
            <Text ellipsis weight={600}>
              {topicTitle || selectedTopic?.title || t('sidebar.newConversation')}
            </Text>
          }
          right={
            <Flexbox horizontal align="center" gap={4}>
              <TerminalPanelToggle />
              <WorkingPanelToggle />
              <TopicActions
                id={topicId}
                status={selectedTopic?.status}
                title={topicTitle || selectedTopic?.title || t('directories.untitled')}
                completionLabel={t(
                  selectedTopic?.status === 'completed' ? 'topics.resume' : 'topics.complete',
                )}
              />
            </Flexbox>
          }
        />
      }
    >
      <ChatHydration getConversationPath={getConversationPath} getTopicPath={getTopicPath} />
      <ChatConversation />
    </ConversationWorkspace>
  );
});

ProjectConversation.displayName = 'ProjectConversation';

export default ProjectConversation;
