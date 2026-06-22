'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import Avatar from './Avatar';

const HeaderInfo = memo(() => {
  const { t } = useTranslation('chat');
  const { gid } = useParams<{ gid: string }>();
  const groupMeta = useAgentGroupStore((s) => agentGroupSelectors.getGroupMeta(gid ?? '')(s));

  const displayTitle = groupMeta.title || t('untitledGroup');

  return (
    <Flexbox
      horizontal
      align={'center'}
      flex={1}
      gap={8}
      style={{
        overflow: 'hidden',
      }}
    >
      <Avatar />
      <Text ellipsis weight={500}>
        {displayTitle}
      </Text>
    </Flexbox>
  );
});

export default HeaderInfo;
