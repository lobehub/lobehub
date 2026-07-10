'use client';

import { Block, Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

import AuthCard from '@/features/AuthCard';

const InteractionDetailsSkeleton = memo(() => (
  <Flexbox gap={16} width={'min(100%,400px)'}>
    <Flexbox horizontal align={'center'} justify={'center'} width={'100%'}>
      <Skeleton.Avatar active shape={'square'} size={72} />
    </Flexbox>
    <AuthCard
      title={<Skeleton.Button active block style={{ height: 40 }} />}
      footer={
        <Flexbox gap={12} width={'100%'}>
          <Skeleton.Button active block size="large" />
          <Skeleton.Button active block size="large" />
        </Flexbox>
      }
      subtitle={
        <Flexbox gap={8} width={'100%'}>
          <Skeleton.Button active block style={{ height: 22 }} />
          <Skeleton.Button active style={{ height: 22, width: '72%' }} />
        </Flexbox>
      }
    >
      <Flexbox gap={12} width={'100%'}>
        <Skeleton.Button active style={{ height: 22, width: '54%' }} />
        <Flexbox gap={8} width={'100%'}>
          <Block padding={16} variant={'filled'}>
            <Skeleton.Button active block />
          </Block>
          <Block padding={16} variant={'filled'}>
            <Skeleton.Button active style={{ width: '68%' }} />
          </Block>
        </Flexbox>
      </Flexbox>
    </AuthCard>
  </Flexbox>
));

InteractionDetailsSkeleton.displayName = 'OAuthInteractionDetailsSkeleton';

export default InteractionDetailsSkeleton;
