'use client';

import { ActionIcon, Avatar, Block, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ChevronsUpDownIcon } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { SkeletonItem } from '@/features/NavPanel/components/SkeletonList';
import { useRouteAgentId } from '@/hooks/useRouteAgentId';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';

import SwitchPanel from './SwitchPanel';

const Agent = memo<PropsWithChildren>(() => {
  const { t } = useTranslation(['chat', 'common']);

  const agentId = useRouteAgentId();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const isInbox = !!inboxAgentId && agentId === inboxAgentId;
  const isLoading = useAgentStore(agentByIdSelectors.isAgentConfigLoadingById(agentId));
  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId), isEqual);
  const { avatar, backgroundColor, title } = meta;

  const displayTitle = isInbox
    ? title || 'Lobe AI'
    : title || t('defaultSession', { ns: 'common' });

  if (isLoading) return <SkeletonItem height={32} padding={0} />;

  return (
    <SwitchPanel>
      <Block
        clickable
        horizontal
        align={'center'}
        gap={8}
        padding={2}
        variant={'borderless'}
        style={{
          minWidth: 32,
          overflow: 'hidden',
        }}
      >
        <Avatar
          avatar={isInbox ? avatar || DEFAULT_INBOX_AVATAR : avatar || DEFAULT_AVATAR}
          background={backgroundColor || undefined}
          shape={'square'}
          size={28}
        />
        <Text ellipsis weight={500}>
          {displayTitle}
        </Text>
        <ActionIcon
          icon={ChevronsUpDownIcon}
          size={DESKTOP_HEADER_ICON_SMALL_SIZE}
          style={{
            width: 24,
          }}
        />
      </Block>
    </SwitchPanel>
  );
});

export default Agent;
