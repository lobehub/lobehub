'use client';

import { Block, Flexbox, Grid, Skeleton } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  footer: css`
    border-block-start: 1px dashed ${cssVar.colorBorder};
    background: ${cssVar.colorBgContainer};
  `,
}));

const Card = memo<{ banner?: boolean }>(({ banner }) => {
  return (
    <Block height={'100%'} style={{ overflow: 'hidden' }} variant={'outlined'} width={'100%'}>
      {banner && <Skeleton.Block active height={64} width={'100%'} />}
      {/* Header with avatar and title */}
      <Flexbox horizontal gap={16} padding={16}>
        <Flexbox horizontal gap={12} style={{ flex: 1, overflow: 'hidden' }}>
          <Skeleton.Avatar active shape="square" size={40} style={{ flex: 'none' }} />
          <Flexbox flex={1} gap={4} style={{ overflow: 'hidden' }}>
            <Skeleton.Button
              active
              size={'small'}
              style={{
                height: 20,
                width: '80%',
              }}
            />
            <Skeleton.Button
              active
              size={'small'}
              style={{
                height: 14,
                width: '50%',
              }}
            />
          </Flexbox>
        </Flexbox>
        <Skeleton.Button
          active
          size={'small'}
          style={{
            height: 24,
            width: 24,
          }}
        />
      </Flexbox>

      {/* Description */}
      <Flexbox gap={12} paddingInline={16}>
        <Skeleton.Paragraph active fontSize={14} rows={3} style={{ marginBottom: 0 }} />
        <Flexbox horizontal gap={8}>
          <Skeleton.Button
            active
            size={'small'}
            style={{
              height: 20,
              width: 60,
            }}
          />
          <Skeleton.Button
            active
            size={'small'}
            style={{
              height: 20,
              width: 50,
            }}
          />
        </Flexbox>
      </Flexbox>

      {/* Footer */}
      <Flexbox horizontal className={styles.footer} gap={4} padding={16} style={{ marginTop: 12 }}>
        <Skeleton.Button
          active
          size={'small'}
          style={{
            height: 14,
            width: 100,
          }}
        />
      </Flexbox>
    </Block>
  );
});

interface GridLoadingCardProps {
  banner?: boolean;
  count?: number;
  rows?: number;
}

const GridLoadingCard = memo<GridLoadingCardProps>(({ count = 8, rows = 4, banner }) => (
  <Grid maxItemWidth={280} rows={rows}>
    {Array.from({ length: count }).map((_, index) => (
      <Card banner={banner} key={index} />
    ))}
  </Grid>
));

export default GridLoadingCard;
