'use client';

import { ActionIcon, Avatar, Block, Text } from '@lobehub/ui';
import { ChevronsUpDownIcon } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { SkeletonItem } from '@/features/NavPanel/components/SkeletonList';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';

import SwitchPanel from './SwitchPanel';

const Agent = memo<PropsWithChildren>(() => {
  const { t } = useTranslation(['chat', 'common']);

  const [isLoading, isInbox, title, role, avatar, backgroundColor] = useAgentStore((s) => [
    agentSelectors.isAgentConfigLoading(s),
    builtinAgentSelectors.isInboxAgent(s),
    agentSelectors.currentAgentDisplayName(s),
    agentSelectors.currentAgentTitle(s),
    agentSelectors.currentAgentAvatar(s),
    agentSelectors.currentAgentBackgroundColor(s),
  ]);

  // Show the role beside the name only when the name is what won the label —
  // otherwise the label already is the role and the tag would repeat it.
  const roleTag = title && role?.trim() && title !== role.trim() ? role.trim() : undefined;

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
        {roleTag ? (
          <Text ellipsis style={{ flex: 'none', fontSize: 12 }} type={'secondary'}>
            {roleTag}
          </Text>
        ) : null}
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
