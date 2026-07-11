'use client';

import { Avatar, Flexbox, Markdown, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import Loading from '@/components/Loading/BrandTextLoading';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Body = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useChatStore(chatPortalSelectors.agentDetailId) || '';
  const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
  const { error, isLoading, mutate } = useFetchAgentConfig(true, agentId);
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId));
  const openingMessage = useAgentStore(
    (s) => agentSelectors.getAgentConfigById(agentId)(s)?.openingMessage,
  );

  if (!agentId) return null;

  if (error) {
    return (
      <Flexbox flex={1} padding={24}>
        <AsyncError error={error} variant="page" onRetry={() => void mutate()} />
      </Flexbox>
    );
  }

  if (isLoading) return <Loading debugId="PortalAgentDetail" />;

  return (
    <Flexbox align="center" flex={1} gap={16} padding={32} style={{ overflowY: 'auto' }}>
      <Avatar avatar={meta.avatar} background={meta.backgroundColor} shape="square" size={80} />
      <Text align="center" fontSize={24} weight="bold">
        {meta.title || t('defaultSession', { ns: 'common' })}
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
