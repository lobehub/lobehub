'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { catalogStyles } from '@/features/Marketplace/Catalog/styles';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from './Bar';
import { CommunityPageChrome } from './CommunityList';

export const CatalogRowsSkeleton = ({ count = 6 }: { count?: number }) => {
  return (
    <div aria-busy {...stylex.props(catalogStyles.grid)}>
      {Array.from({ length: count }, (_, index) => (
        <Flexbox horizontal align={'center'} gap={12} height={60} key={index} paddingInline={8}>
          <SkeletonBar height={40} width={40} />
          <Flexbox flex={1} gap={6}>
            <SkeletonBar height={14} width={'40%'} />
            <SkeletonBar height={12} width={'70%'} />
          </Flexbox>
          <SkeletonBar height={24} width={72} />
        </Flexbox>
      ))}
    </div>
  );
};

export const MarketplaceCatalogSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => (
  <CommunityPageChrome chrome={chrome}>
    <div {...stylex.props(catalogStyles.frame)}>
      <Flexbox gap={24} style={{ paddingBlockStart: 24 }}>
        <Flexbox gap={4}>
          <SkeletonBar height={28} width={112} />
          <SkeletonBar height={20} width={'min(100%, 420px)'} />
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8}>
          <Flexbox flex={1} style={{ minWidth: 0 }}>
            <SkeletonBar height={32} />
          </Flexbox>
          <SkeletonBar height={32} width={120} />
        </Flexbox>
      </Flexbox>
      <div {...stylex.props(catalogStyles.section)}>
        <SkeletonBar height={32} width={132} />
        <CatalogRowsSkeleton />
      </div>
    </div>
  </CommunityPageChrome>
);
