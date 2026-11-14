'use client';

import { Block, Center, Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

import PromptInput from '../PromptInput';

interface SkeletonListProps {
  embedInput?: boolean;
}

const SkeletonList = memo<SkeletonListProps>(({ embedInput = true }) => (
  <Flexbox style={{ minHeight: 'calc(100vh - 44px)' }}>
    <Block variant={'borderless'}>
      <Flexbox gap={12}>
        {/* Prompt */}
        <Skeleton height={20} width={'80%'} />
        {/* Song cards */}
        <Skeleton height={88} />
        <Skeleton height={88} />
        {/* Metadata */}
        <Skeleton height={14} width={140} />
      </Flexbox>
    </Block>
    <div style={{ flex: 1 }} />
    {embedInput && (
      <Center style={{ bottom: 24, position: 'sticky', width: '100%' }}>
        <PromptInput disableAnimation showTitle={false} />
      </Center>
    )}
  </Flexbox>
));

SkeletonList.displayName = 'SkeletonList';

export default SkeletonList;
