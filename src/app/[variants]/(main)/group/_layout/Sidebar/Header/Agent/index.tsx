'use client';

import { ActionIcon, Block, Text } from '@lobehub/ui';
import { ChevronsUpDownIcon } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SupervisorAvatar from '@/app/[variants]/(main)/group/features/GroupAvatar';
import { SkeletonItem } from '@/features/NavPanel/components/SkeletonList';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import SwitchPanel from './SwitchPanel';

const Agent = memo<PropsWithChildren>(() => {
  const { t } = useTranslation(['chat', 'common']);

  const [isGroupsInit, groupMeta] = useAgentGroupStore((s) => [
    agentGroupSelectors.isGroupsInit(s),
    agentGroupSelectors.currentGroupMeta(s),
  ]);

  const displayTitle = groupMeta?.title || t('untitledGroup', { ns: 'chat' });

  if (isGroupsInit) return <SkeletonItem height={32} padding={0} />;

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
        <SupervisorAvatar size={28} />
        <Text ellipsis weight={500}>
          {displayTitle}
        </Text>
        <ActionIcon
          icon={ChevronsUpDownIcon}
          size={{
            blockSize: 28,
            size: 16,
          }}
          style={{
            width: 24,
          }}
        />
      </Block>
    </SwitchPanel>
  );
});

export default Agent;
