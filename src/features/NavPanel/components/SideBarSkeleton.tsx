'use client';

import { Center, Flexbox, Skeleton } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import { isMacDesktop } from '../ToggleLeftPanelButton';

interface SkeletonBarProps {
  height: number;
  radius?: number | string;
  width?: number | string;
}

const SkeletonBar = memo<SkeletonBarProps>(({ height, width = '100%', radius }) => (
  <Skeleton.Button
    active
    block
    size={'small'}
    style={{
      borderRadius: radius ?? cssVar.borderRadius,
      height,
      margin: 0,
      maxHeight: height,
      maxWidth: width,
      minHeight: height,
      minWidth: width,
      opacity: 0.5,
      padding: 0,
      width,
    }}
  />
));

export type SideBarHeaderVariant = 'breadcrumb' | 'title';

// The real header's height comes from its tallest child. A breadcrumb header holds
// a 22px trail plus a 28px action icon — and ToggleLeftPanelButton renders nothing
// on macOS desktop, so 22 wins there. A title header (agent / page / home) carries
// a 16px title beside a back button and settles at 32.
const headerContentHeight = (variant: SideBarHeaderVariant) => {
  if (variant === 'title') return 32;
  return isMacDesktop ? 22 : 28;
};

export const SideBarHeaderSkeleton = memo<{ variant?: SideBarHeaderVariant }>(
  ({ variant = 'breadcrumb' }) => (
    <Flexbox horizontal align={'center'} flex={'none'} padding={'8px 6px'}>
      <Flexbox flex={1} height={headerContentHeight(variant)} justify={'center'} paddingInline={6}>
        <SkeletonBar height={variant === 'title' ? 18 : 14} width={variant === 'title' ? 96 : 72} />
      </Flexbox>
    </Flexbox>
  ),
);

const SkeletonNavItem = memo<{ width: string }>(({ width }) => (
  <Flexbox horizontal align={'center'} flex={'none'} gap={8} height={36} paddingInline={4}>
    <Center flex={'none'} height={28} width={28}>
      <SkeletonBar height={18} radius={cssVar.borderRadiusSM} width={18} />
    </Center>
    <Flexbox flex={1}>
      <SkeletonBar height={14} width={width} />
    </Flexbox>
  </Flexbox>
));

const TITLE_WIDTHS = [56, 72, 48, 64];
const ITEM_WIDTHS = ['62%', '44%', '70%', '52%', '66%', '48%', '58%', '74%'];

// `paddingBlock` mirrors the accordion content wrapper; the header-slot nav list has
// no such padding, so passing 0 there keeps the skeleton 2px shorter and on target.
const SkeletonRows = memo<{ count: number; gap?: number; paddingBlock?: number; seed?: number }>(
  ({ count, seed = 0, paddingBlock = 1, gap = 1 }) => (
    <Flexbox gap={gap} paddingBlock={paddingBlock}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonNavItem key={index} width={ITEM_WIDTHS[(seed * 3 + index) % ITEM_WIDTHS.length]} />
      ))}
    </Flexbox>
  ),
);

export interface NavSkeletonShape {
  /** `gap` of the body flex column, matching the real sidebar's body wrapper. */
  bodyGap?: number;
  bodyPaddingBlock?: number;
  /** Row count per accordion group; 0 renders a collapsed group (title only). */
  groups?: number[];
  /** Accordion header height: 27 with `paddingBlock={4}`, 32 by default, 40 with a toolbar. */
  groupTitleHeight?: number;
  headerVariant?: SideBarHeaderVariant;
  /** Rows inside the body that sit above the first group. */
  leadingRows?: number;
  /** `gap` between the header-slot nav rows. */
  navGap?: number;
  /** Fixed rows rendered in the header slot, above the scroll area. */
  navRows?: number;
  /** A search box placeholder inside the body (settings only). */
  search?: boolean;
}

export const NavSideBarSkeleton = memo<NavSkeletonShape>(
  ({
    bodyGap = 0,
    bodyPaddingBlock = 0,
    groups,
    groupTitleHeight = 32,
    headerVariant = 'breadcrumb',
    leadingRows = 0,
    navGap = 1,
    navRows = 0,
    search = false,
  }) => {
    const hasBody = search || leadingRows > 0 || !!groups?.length;

    return (
      <Flexbox data-testid={'nav-sidebar-skeleton'} gap={1} style={{ height: '100%' }}>
        <SideBarHeaderSkeleton variant={headerVariant} />
        {navRows > 0 && (
          <Flexbox data-testid={'nav-sidebar-skeleton-nav'} flex={'none'} paddingInline={4}>
            <SkeletonRows count={navRows} gap={navGap} paddingBlock={0} />
          </Flexbox>
        )}
        {hasBody && (
          <Flexbox
            gap={bodyGap}
            paddingBlock={bodyPaddingBlock}
            paddingInline={4}
            style={{ overflow: 'hidden' }}
          >
            {search && (
              <Flexbox data-testid={'nav-sidebar-skeleton-search'} paddingInline={4}>
                <SkeletonBar height={36} />
              </Flexbox>
            )}
            {leadingRows > 0 && <SkeletonRows count={leadingRows} paddingBlock={0} />}
            {!!groups?.length && (
              <Flexbox gap={8}>
                {groups.map((rows, groupIndex) => (
                  <Flexbox key={groupIndex}>
                    <Flexbox
                      flex={'none'}
                      height={groupTitleHeight}
                      justify={'center'}
                      paddingBlock={4}
                      paddingInline={'8px 4px'}
                    >
                      <SkeletonBar
                        height={12}
                        width={TITLE_WIDTHS[groupIndex % TITLE_WIDTHS.length]}
                      />
                    </Flexbox>
                    {rows > 0 && <SkeletonRows count={rows} seed={groupIndex} />}
                  </Flexbox>
                ))}
              </Flexbox>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

// Every shape below was measured against its settled sidebar in the desktop shell
// (301px panel): header slot height, body gap/padding, accordion header height, and
// group composition. A shape that drifts from its sidebar shifts the whole list at
// the moment the route chunk resolves, which is the defect this file exists to avoid.
export const NAV_SKELETON_SHAPES: Record<string, NavSkeletonShape> = {
  'agent': { groups: [0, 12], headerVariant: 'title', navRows: 5 },
  'discover': { navRows: 6 },
  'eval': { bodyGap: 8, groups: [3, 3], groupTitleHeight: 27, leadingRows: 1 },
  'evalBench': { bodyGap: 8, groups: [3, 3], groupTitleHeight: 27, leadingRows: 1 },
  'group': { groups: [3, 8], headerVariant: 'title' },
  'home': { bodyGap: 1, groups: [5, 7, 3], headerVariant: 'title', leadingRows: 2, navRows: 2 },
  'image': { bodyGap: 1, groups: [4], groupTitleHeight: 40, navGap: 0, navRows: 2 },
  'memory': { navRows: 7 },
  'page': { bodyGap: 1, groups: [12], headerVariant: 'title', navRows: 1 },
  'resource': { bodyPaddingBlock: 8, groups: [5], navRows: 6 },
  'resourceLibrary': { bodyPaddingBlock: 8, groups: [6] },
  'settings': { bodyGap: 4, groups: [6, 5, 8, 3], groupTitleHeight: 27, search: true },
  'video': { bodyGap: 1, groups: [4], groupTitleHeight: 40, navGap: 0, navRows: 2 },
  'workspace-settings': { groups: [5, 5, 6, 3], groupTitleHeight: 27 },
};

export const DEFAULT_NAV_SKELETON_SHAPE: NavSkeletonShape = { groups: [6, 4] };
