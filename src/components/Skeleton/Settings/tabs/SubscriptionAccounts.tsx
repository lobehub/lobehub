'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';

import SkeletonBar from '../../Bar';
import type { SettingsTabSkeleton } from './types';

/**
 * What `SubscriptionAccounts` itself shows while its first list read settles:
 * the refresh button alone (search and the provider filter only appear once
 * there are accounts) over five row bars, so the hand-over keeps one shape.
 */
const Body = () => (
  <Flexbox gap={16} width={'100%'}>
    <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
      <SkeletonBar height={28} width={28} />
    </Flexbox>
    <Flexbox gap={4}>
      {Array.from({ length: 5 }, (_, i) => (
        <SkeletonBar height={56} key={i} radius={cssVar.borderRadius} />
      ))}
    </Flexbox>
  </Flexbox>
);

const SubscriptionAccountsSkeleton: SettingsTabSkeleton = { Body };

export default SubscriptionAccountsSkeleton;
