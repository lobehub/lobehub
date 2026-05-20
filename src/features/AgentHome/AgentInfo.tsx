'use client';

import { Avatar, Flexbox, Markdown, Skeleton, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';

const AgentInfo = memo(() => {
  const { t } = useTranslation(['chat', 'welcome']);
  const isLoading = useAgentStore(agentSelectors.isAgentConfigLoading);
  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const openingMessage = useAgentStore(agentSelectors.openingMessage);
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
