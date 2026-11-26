'use client';

import { Center, cssVar, Flexbox } from '@lobehub/ui';

import { isDesktop } from '@/const/version';
import { getContainerTopInset } from '@/features/DesktopLayoutContainer/cssVariables';
import { type DensityTokens, usePanelDensityTokens } from '@/styles/density';
import { isMacOS } from '@/utils/platform';

import SkeletonBar from '../Bar';

const isMacDesktop = isDesktop && isMacOS();

export type SideBarHeaderVariant = 'breadcrumb' | 'title';

const headerContentHeight = (variant: SideBarHeaderVariant, tokens: DensityTokens | null) => {
  if (variant === 'title') return (tokens?.headerAvatarSize ?? 28) + 4;
  return isMacDesktop ? 22 : 28;
};

export const SideBarHeaderSkeleton = ({
  variant = 'breadcrumb',
}: {
  variant?: SideBarHeaderVariant;
}) => {
  const tokens = usePanelDensityTokens();
  const topInset = getContainerTopInset();

  return (
    <Flexbox
      horizontal
      align={'center'}
      flex={'none'}
      height={tokens ? tokens.headerHeight + topInset : undefined}
      padding={tokens ? undefined : '8px 6px'}
      paddingInline={tokens ? 6 : undefined}
      style={tokens ? { paddingBlockStart: topInset } : undefined}
    >
      <Flexbox
        flex={1}
        height={headerContentHeight(variant, tokens)}
        justify={'center'}
        paddingInline={6}
      >
        <SkeletonBar height={variant === 'title' ? 18 : 14} width={variant === 'title' ? 96 : 72} />
      </Flexbox>
    </Flexbox>
  );
};

const SkeletonNavItem = ({ width }: { width: string }) => {
  const tokens = usePanelDensityTokens();
  const iconBox = tokens?.iconBox ?? 28;
  const iconSize = tokens?.iconSize ?? 18;

  return (
    <Flexbox
      horizontal
      align={'center'}
      flex={'none'}
      gap={tokens?.gap ?? 8}
      height={tokens?.rowHeight ?? 36}
      paddingInline={tokens?.paddingInline ?? 4}
    >
      <Center flex={'none'} height={iconBox} width={iconBox}>
        <SkeletonBar height={iconSize} radius={cssVar.borderRadiusSM} width={iconSize} />
      </Center>
      <Flexbox flex={1}>
        <SkeletonBar height={tokens?.fontSize ?? 14} width={width} />
      </Flexbox>
    </Flexbox>
  );
};

const TITLE_WIDTHS = [56, 72, 48, 64];
const ITEM_WIDTHS = ['62%', '44%', '70%', '52%', '66%', '48%', '58%', '74%'];

const SkeletonRows = ({
  count,
  seed = 0,
  paddingBlock = 1,
  gap = 1,
}: {
  count: number;
  gap?: number;
  paddingBlock?: number;
  seed?: number;
}) => (
  <Flexbox gap={gap} paddingBlock={paddingBlock}>
    {Array.from({ length: count }).map((_, index) => (
      <SkeletonNavItem key={index} width={ITEM_WIDTHS[(seed * 3 + index) % ITEM_WIDTHS.length]} />
    ))}
  </Flexbox>
);

export interface NavSkeletonShape {
  bodyGap?: number;
  bodyPaddingBlock?: number;
  groups?: number[];
  groupTitleHeight?: number;
  headerVariant?: SideBarHeaderVariant;
  leadingRows?: number;
  navGap?: number;
  navRows?: number;
  search?: boolean;
}

export const NavSideBarSkeleton = ({
  bodyGap = 0,
  bodyPaddingBlock = 0,
  groups,
  groupTitleHeight,
  headerVariant = 'breadcrumb',
  leadingRows = 0,
  navGap = 1,
  navRows = 0,
  search = false,
}: NavSkeletonShape) => {
  const tokens = usePanelDensityTokens();
  const panelPaddingInline = tokens?.panelPaddingInline ?? 4;
  const titleHeight = groupTitleHeight ?? tokens?.sectionHeaderHeight ?? 32;
  const hasBody = search || leadingRows > 0 || !!groups?.length;

  return (
    <Flexbox data-testid={'nav-sidebar-skeleton'} gap={1} style={{ height: '100%' }}>
      <SideBarHeaderSkeleton variant={headerVariant} />
      {navRows > 0 && (
        <Flexbox
          data-testid={'nav-sidebar-skeleton-nav'}
          flex={'none'}
          paddingInline={panelPaddingInline}
        >
          <SkeletonRows count={navRows} gap={navGap} paddingBlock={0} />
        </Flexbox>
      )}
      {hasBody && (
        <Flexbox
          gap={bodyGap}
          paddingBlock={bodyPaddingBlock}
          paddingInline={panelPaddingInline}
          style={{ overflow: 'hidden' }}
        >
          {search && (
            <Flexbox data-testid={'nav-sidebar-skeleton-search'} paddingInline={4}>
              <SkeletonBar height={36} />
            </Flexbox>
          )}
          {leadingRows > 0 && <SkeletonRows count={leadingRows} paddingBlock={0} />}
          {!!groups?.length && (
            <Flexbox gap={tokens?.sectionGap ?? 8}>
              {groups.map((rows, groupIndex) => (
                <Flexbox key={groupIndex}>
                  <Flexbox
                    flex={'none'}
                    height={titleHeight}
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
};

export const NAV_SKELETON_SHAPES: Record<string, NavSkeletonShape> = {
  'agent': { groups: [0, 12], headerVariant: 'title', navRows: 5 },
  'discover': { navRows: 6 },
  'eval': { bodyGap: 8, groups: [3, 3], groupTitleHeight: 27, leadingRows: 1 },
  'evalBench': { bodyGap: 8, groups: [3, 3], groupTitleHeight: 27, leadingRows: 1 },
  'group': { groups: [3, 8], headerVariant: 'title' },
  'home': { bodyGap: 1, groups: [5, 7, 3], headerVariant: 'title', leadingRows: 2, navRows: 2 },
  'image': { bodyGap: 1, groups: [4], groupTitleHeight: 40, navGap: 0, navRows: 2 },
  'memory': { navRows: 7 },
  'music': { bodyGap: 1, groups: [4], groupTitleHeight: 40, navGap: 0, navRows: 2 },
  'page': { bodyGap: 1, groups: [12], headerVariant: 'title', navRows: 1 },
  'resource': { bodyPaddingBlock: 8, groups: [5], navRows: 6 },
  'resourceLibrary': { bodyPaddingBlock: 8, groups: [6], search: true },
  'settings': { bodyGap: 4, groups: [6, 5, 8, 3], groupTitleHeight: 27, search: true },
  'video': { bodyGap: 1, groups: [4], groupTitleHeight: 40, navGap: 0, navRows: 2 },
  'workspace-settings': { groups: [5, 5, 6, 3], groupTitleHeight: 27 },
};

export const DEFAULT_NAV_SKELETON_SHAPE: NavSkeletonShape = { groups: [6, 4] };
