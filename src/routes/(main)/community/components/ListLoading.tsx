'use client';

import { Block, Flexbox, Grid, Skeleton } from '@lobehub/ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import { memo } from 'react';

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
            <Skeleton.Avatar active shape="square" size={40} style={{ flex: 'none' }} />
            <Flexbox flex={1} gap={4}>
              <Skeleton.Button active style={{ height: 20, width: '70%' }} />
              <Skeleton.Button active style={{ height: 14, width: '40%' }} />
            </Flexbox>
          </Flexbox>

          {/* Description */}
          <Skeleton.Paragraph active rows={3} style={{ marginBottom: 0 }} />

          {/* Tags */}
          <Flexbox horizontal gap={8}>
            <Skeleton.Button active size={'small'} style={{ height: 20, width: 60 }} />
            <Skeleton.Button active size={'small'} style={{ height: 20, width: 50 }} />
          </Flexbox>

          {/* Footer */}
          <Flexbox
            className={styles.footer}
            gap={4}
            padding={8}
            style={{ marginBottom: -16, marginInline: -16 }}
          >
            <Skeleton.Button active size={'small'} style={{ height: 14, width: 100 }} />
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
        {!mobile && <Skeleton paragraph={{ rows: 1 }} style={{ width: 200 }} title={false} />}
        <Flexbox horizontal align={'center'} gap={16} width={'100%'}>
          <Skeleton.Avatar active size={mobile ? 48 : 64} />
          <Skeleton.Button active style={{ height: 36, width: 200 }} />
        </Flexbox>
        <Skeleton.Button active size={'small'} style={{ width: 200 }} />
      </Flexbox>
      <Flexbox
        horizontal
        gap={12}
        height={54}
        style={{
          borderBottom: `1px solid ${cssVar.colorBorder}`,
        }}
      >
        <Skeleton.Button />
        <Skeleton.Button />
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
          <Skeleton paragraph={{ rows: 3 }} title={false} />
          <Skeleton paragraph={{ rows: 8 }} title={false} />
          <Skeleton paragraph={{ rows: 8 }} title={false} />
        </Flexbox>
        <Flexbox gap={16} width={360}>
          <Skeleton paragraph={{ rows: 3 }} title={false} />
          <Skeleton paragraph={{ rows: 4 }} title={false} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});
export default ListLoading;
