'use client';

import { Block, Flexbox, Grid } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import { memo } from 'react';

import { ArticleSkeleton } from '@/components/Skeleton';

const styles = createStaticStyles(({ css, cssVar }) => ({
  footer: css`
    border-block-start: 1px dashed ${cssVar.colorBorder};
    background: ${cssVar.colorBgContainer};
  `,
}));

const ListLoading = memo<{ length?: number; rows?: number }>(({ rows = 3, length = 12 }) => {
  return (
    <Grid rows={rows} width={'100%'}>
      {Array.from({ length }).map((_, index) => (
        <Block gap={12} key={index} padding={16} variant={'outlined'}>
          {/* Header */}
          <Flexbox horizontal align={'center'} gap={12}>
            <Skeleton.Avatar shape="square" size={40} style={{ flex: 'none' }} />
            <Flexbox flex={1} gap={4}>
              <Skeleton height={20} width={'70%'} />
              <Skeleton height={14} width={'40%'} />
            </Flexbox>
          </Flexbox>

          {/* Description */}
          <Skeleton.Text rows={3} style={{ marginBottom: 0 }} />

          {/* Tags */}
          <Flexbox horizontal gap={8}>
            <Skeleton height={20} width={60} />
            <Skeleton height={20} width={50} />
          </Flexbox>

          {/* Footer */}
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
  );
});

export const DetailsLoading = memo(() => {
  const { mobile } = useResponsive();
  return (
    <Flexbox gap={24}>
      <Flexbox gap={12}>
        {!mobile && <ArticleSkeleton rows={1} style={{ width: 200 }} title={false} />}
        <Flexbox horizontal align={'center'} gap={16} width={'100%'}>
          <Skeleton.Avatar size={mobile ? 48 : 64} />
          <Skeleton height={36} width={200} />
        </Flexbox>
        <Skeleton height={28} width={200} />
      </Flexbox>
      <Flexbox
        horizontal
        gap={12}
        height={54}
        style={{
          borderBottom: `1px solid ${cssVar.colorBorder}`,
        }}
      >
        <Skeleton height={36} />
        <Skeleton height={36} />
      </Flexbox>
      <Flexbox
        gap={48}
        horizontal={!mobile}
        style={mobile ? { flexDirection: 'column-reverse' } : undefined}
      >
        <Flexbox
          flex={1}
          gap={16}
          width={'100%'}
          style={{
            overflow: 'hidden',
          }}
        >
          <Skeleton.Text rows={3} />
          <Skeleton.Text rows={8} />
          <Skeleton.Text rows={8} />
        </Flexbox>
        <Flexbox gap={16} width={360}>
          <Skeleton.Text rows={3} />
          <Skeleton.Text rows={4} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});
export default ListLoading;
