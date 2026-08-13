'use client';

import { ActionIcon, Block, Text } from '@lobehub/ui';
import { ChevronsUpDownIcon } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { SkeletonItem } from '@/features/NavPanel/components/SkeletonList';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { chatGroupProjectionSelectors, useChatGroupProjection } from '@/projection';
import SupervisorAvatar from '@/routes/(main)/group/features/GroupAvatar';

import SwitchPanel from './SwitchPanel';

const Agent = memo<PropsWithChildren>(() => {
  const { t } = useTranslation(['chat', 'common']);

  const { gid } = useActiveRouteParams<{ gid: string }>();
  const group = useChatGroupProjection(chatGroupProjectionSelectors.getGroupById(gid ?? ''));
  const groupMeta = useChatGroupProjection(chatGroupProjectionSelectors.getGroupMeta(gid ?? ''));

  const displayTitle = groupMeta?.title || t('untitledGroup', { ns: 'chat' });

  if (!group) return <SkeletonItem height={32} padding={0} />;

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
