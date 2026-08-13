'use client';

import { agentDisplayName } from '@lobechat/types';
import { Avatar, Flexbox, Markdown, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import { AgentNotFound } from '@/features/AgentNotFound';
import { useAgentStore } from '@/store/agent';
import {
  agentProjectionSelectors,
  useAgentConfigStatus,
  useAgentMeta,
  useAgentValue,
} from '@/store/agent/projection';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Body = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useChatStore(chatPortalSelectors.agentDetailId) || '';
  const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
  const { error, isLoading, mutate } = useFetchAgentConfig(true, agentId);
  const meta = useAgentMeta(agentId);
  const openingMessage = useAgentValue(agentId, agentProjectionSelectors.openingMessage);
  const isNotFound = useAgentConfigStatus(agentId).isNotFound;

  if (!agentId) return null;

  // The fetch settled on `null` — the agent was deleted or made private by
  // its owner. A terminal 404, distinct from the retryable transport error.
  if (isNotFound) {
    return (
      <Flexbox flex={1} style={{ overflowY: 'auto' }}>
        <AgentNotFound />
      </Flexbox>
    );
  }

  if (error) {
    return (
      <Flexbox flex={1} padding={24}>
        <AsyncError error={error} variant="page" onRetry={() => void mutate()} />
      </Flexbox>
    );
  }

  if (isLoading) return <SurfaceSkeleton header={false} variant={'form'} />;

  return (
    <Flexbox align="center" flex={1} gap={16} padding={32} style={{ overflowY: 'auto' }}>
      <Avatar avatar={meta.avatar} background={meta.backgroundColor} shape="square" size={80} />
      <Text align="center" fontSize={24} weight="bold">
        {agentDisplayName(meta, t('defaultSession', { ns: 'common' }))}
      </Text>
      {meta.description && (
        <Text align="center" type="secondary">
          {meta.description}
        </Text>
      )}
      {openingMessage && (
        <Flexbox width="min(100%, 560px)">
          <Markdown variant="chat">{openingMessage}</Markdown>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default Body;
