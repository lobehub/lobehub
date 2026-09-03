'use client';

import { Block, Flexbox, Grid } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

const styles = createStaticStyles(({ css, cssVar }) => ({
  footer: css`
    border-block-start: 1px dashed ${cssVar.colorBorder};
    background: ${cssVar.colorBgContainer};
  `,
  toolbar: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

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
    <Flexbox gap={16} width={'100%'}>
      {chrome !== 'body' && (
        <Flexbox
          horizontal
          align={'center'}
          className={styles.toolbar}
          gap={12}
          height={56}
          justify={'space-between'}
          paddingInline={16}
        >
          <Skeleton height={20} width={280} />
          <Skeleton height={28} width={132} />
        </Flexbox>
      )}
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
  ),
);

CommunityListSkeleton.displayName = 'CommunityListSkeleton';

export default CommunityListSkeleton;
