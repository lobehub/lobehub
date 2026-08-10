'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { memo, useCallback, useLayoutEffect } from 'react';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import ChatConversation from '@/routes/(main)/agent/features/Conversation';
import ChatHydration from '@/routes/(main)/agent/features/Conversation/ChatHydration';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';

import { getProjectConversationPath } from '../Layout/navigation';

const ProjectConversation = memo(() => {
  const { projectId } = useParams<{ projectId: string; topicId?: string }>();
  const detail = useCurrentProjectDetail(projectId);
  const detailSWR = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const coordinatorAgentId = detail?.project.coordinatorAgentId;

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
    () => getProjectConversationPath(projectId!),
    [projectId],
  );
  const getTopicPath = useCallback(
    (_agentId: string, topicId: string) => getProjectConversationPath(projectId!, topicId),
    [projectId],
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
      <ChatHydration getConversationPath={getConversationPath} getTopicPath={getTopicPath} />
      <ChatConversation />
    </Flexbox>
  );
});

ProjectConversation.displayName = 'ProjectConversation';

export default ProjectConversation;
