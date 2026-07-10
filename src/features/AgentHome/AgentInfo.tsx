'use client';

import { Avatar, Flexbox, Markdown, Skeleton, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';

const AgentInfo = memo(() => {
  const { t } = useTranslation(['chat', 'welcome']);
  // Scope the welcome to the conversation's agent, not the global
  // `activeAgentId`. In the multi-tab desktop app `activeAgentId` is shared and
  // can momentarily point at another tab's agent (or the inbox), which used to
  // flash this card back to the inbox "Lobe AI" identity.
  const agentId = useConversationStore(contextSelectors.agentId) || '';
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const isInbox = !!inboxAgentId && agentId === inboxAgentId;
  const isLoading = useAgentStore(agentByIdSelectors.isAgentConfigLoadingById(agentId));
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId), isEqual);
  const openingMessage = useAgentStore(
    (s) => agentSelectors.getAgentConfigById(agentId)(s)?.openingMessage || '',
  );
  const fontSize = useUserStore(userGeneralSettingsSelectors.fontSize);

  const displayTitle = isInbox
    ? meta.title || 'Lobe AI'
    : meta.title || t('defaultSession', { ns: 'common' });

  const message = useMemo(() => {
    if (openingMessage) return openingMessage;
    return t('agentDefaultMessageWithSystemRole', {
      name: displayTitle,
    });
  }, [openingMessage, displayTitle, t]);

  if (isLoading) {
    return (
      <Flexbox gap={12}>
        <Skeleton.Avatar active shape={'square'} size={64} />
        <Skeleton.Button active style={{ height: 32, width: 200 }} />
        <Flexbox width={'min(100%, 640px)'}>
          <Skeleton active paragraph={{ rows: 2 }} title={false} />
        </Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={12}>
      <Avatar
        avatar={isInbox ? meta.avatar || DEFAULT_INBOX_AVATAR : meta.avatar || DEFAULT_AVATAR}
        background={meta.backgroundColor}
        shape={'square'}
        size={64}
      />
      <Text fontSize={24} weight={'bold'}>
        {displayTitle}
      </Text>
      <Flexbox width={'min(100%, 640px)'}>
        <Markdown fontSize={fontSize} variant={'chat'}>
          {message}
        </Markdown>
      </Flexbox>
    </Flexbox>
  );
});

export default AgentInfo;
