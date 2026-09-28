'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import CommunityListSkeleton, { CommunityPageChrome } from './CommunityList';

const SectionTitle = () => (
  <Flexbox
    horizontal
    align={'center'}
    height={41}
    justify={'space-between'}
    style={{ marginBlockStart: 10 }}
  >
    <Skeleton height={31} width={160} />
    <Skeleton height={32} width={120} />
  </Flexbox>
);

const CommunityHomeSkeleton = memo<RouteSkeletonProps>(({ chrome = 'page' }) => (
  <CommunityPageChrome chrome={chrome}>
    <Flexbox aria-busy gap={16} width={'100%'}>
      <Skeleton height={150} style={{ borderRadius: 12 }} />
      <SectionTitle />
      <CommunityListSkeleton chrome={'body'} length={8} rows={4} />
      <div />
      <SectionTitle />
      <CommunityListSkeleton chrome={'body'} length={8} rows={4} />
    </Flexbox>
  </CommunityPageChrome>
));

CommunityHomeSkeleton.displayName = 'CommunityHomeSkeleton';

export default CommunityHomeSkeleton;
