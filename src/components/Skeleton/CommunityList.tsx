'use client';

import { Block, Flexbox, Grid } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, type ReactNode } from 'react';

import WideScreenContainer from '@/features/WideScreenContainer';
import type { RouteSkeletonChrome, RouteSkeletonProps } from '@/spa/router/routeMeta';

const COMMUNITY_MAX_WIDTH = 1440;

const styles = createStaticStyles(({ css, cssVar }) => ({
  footer: css`
    border-block-start: 1px dashed ${cssVar.colorBorder};
    background: ${cssVar.colorBgContainer};
  `,
  toolbar: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

// Mirrors the community list layout (search header + centered wide-screen
// container) for the fallback that paints before that layout has mounted.
export const CommunityPageChrome = ({
  children,
  chrome,
}: {
  children: ReactNode;
  chrome: RouteSkeletonChrome;
}) => {
  if (chrome === 'body') return children;

  return (
    <Flexbox aria-busy height={'100%'} width={'100%'}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.toolbar}
        flex={'none'}
        gap={12}
        height={56}
        justify={'space-between'}
        paddingInline={16}
      >
        <Skeleton height={20} width={280} />
        <Skeleton height={28} width={132} />
      </Flexbox>
      <Flexbox height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
        <WideScreenContainer
          gap={16}
          minWidth={COMMUNITY_MAX_WIDTH}
          style={{ paddingBottom: 56, paddingTop: 16 }}
        >
          {children}
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
};

export interface CommunityListSkeletonProps extends RouteSkeletonProps {
  length?: number;
  rows?: number;
}

/**
 * Shared by the route fallback and the page's own loading state, so the cards
 * keep their geometry when one hands over to the other. `chrome="body"` drops
 * the toolbar the list layout draws once it has mounted.
 */
const CommunityListSkeleton = memo<CommunityListSkeletonProps>(
  ({ rows = 3, length = 12, chrome = 'page' }) => (
    <CommunityPageChrome chrome={chrome}>
      <Flexbox aria-busy gap={16} width={'100%'}>
        <Grid rows={rows} width={'100%'}>
          {Array.from({ length }).map((_, index) => (
            <Block gap={12} key={index} padding={16} variant={'outlined'}>
              <Flexbox horizontal align={'center'} gap={12}>
                <Skeleton.Avatar shape="square" size={40} style={{ flex: 'none' }} />
                <Flexbox flex={1} gap={4}>
                  <Skeleton height={20} width={'70%'} />
                  <Skeleton height={14} width={'40%'} />
                </Flexbox>
              </Flexbox>
              <Skeleton.Text rows={3} style={{ marginBottom: 0 }} />
              <Flexbox horizontal gap={8}>
                <Skeleton height={20} width={60} />
                <Skeleton height={20} width={50} />
              </Flexbox>
              <Flexbox
                className={styles.footer}
                gap={4}
                padding={8}
                style={{ marginBottom: -16, marginInline: -16 }}
              >
                <Skeleton height={14} width={100} />
              </Flexbox>
            </Block>
          ))}
        </Grid>
      </Flexbox>
    </CommunityPageChrome>
  ),
);

CommunityListSkeleton.displayName = 'CommunityListSkeleton';

export default CommunityListSkeleton;
