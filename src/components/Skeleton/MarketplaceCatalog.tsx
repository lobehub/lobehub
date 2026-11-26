'use client';

import { Flexbox } from '@lobehub/ui';
import { Surface } from '@lobehub/ui/dashboard';
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

const FACT_WIDTHS = ['36%', '24%', '30%', '42%'];

/**
 * A Marketplace page (Agent, skill, app) while it loads, in the shape it
 * renders: the 56px picture with name, blurb and actions, the source line, then
 * the content cards (rows, then the facts).
 */
export const MarketplaceDetailBodySkeleton = () => (
  <Flexbox aria-busy gap={24}>
    <Flexbox horizontal align={'center'} gap={16}>
      <SkeletonBar height={56} radius={14} width={56} />
      <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
        <SkeletonBar height={22} width={'min(100%, 220px)'} />
        <SkeletonBar height={14} width={'min(100%, 420px)'} />
      </Flexbox>
      <Flexbox horizontal flex={'none'} gap={8}>
        <SkeletonBar height={32} radius={8} width={88} />
        <SkeletonBar height={32} radius={8} width={88} />
      </Flexbox>
    </Flexbox>
    <SkeletonBar height={14} width={'min(100%, 320px)'} />
    <Flexbox gap={8}>
      <SkeletonBar height={16} width={64} />
      <Surface>
        <Flexbox gap={12} padding={16}>
          {Array.from({ length: 3 }, (_, index) => (
            <Flexbox horizontal align={'center'} gap={12} key={index}>
              <SkeletonBar height={36} radius={8} width={36} />
              <Flexbox flex={1} gap={6}>
                <SkeletonBar height={14} width={'32%'} />
                <SkeletonBar height={12} width={'58%'} />
              </Flexbox>
            </Flexbox>
          ))}
        </Flexbox>
      </Surface>
    </Flexbox>
    <Flexbox gap={8}>
      <SkeletonBar height={16} width={64} />
      <Surface>
        <Flexbox gap={10} padding={16}>
          {FACT_WIDTHS.map((width, index) => (
            <Flexbox horizontal gap={24} key={index}>
              <SkeletonBar height={14} width={96} />
              <SkeletonBar height={14} width={width} />
            </Flexbox>
          ))}
        </Flexbox>
      </Surface>
    </Flexbox>
  </Flexbox>
);

/** The detail routes' skeleton: the page chrome, then the detail body in the centered column. */
export const MarketplaceDetailSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => (
  <CommunityPageChrome chrome={chrome}>
    <div {...stylex.props(catalogStyles.frame, catalogStyles.pageTop)}>
      <MarketplaceDetailBodySkeleton />
    </div>
  </CommunityPageChrome>
);
