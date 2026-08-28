'use client';

import { Flexbox, Grid } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';

import SkeletonBar from './Bar';

const styles = createStaticStyles(({ css }) => ({
  panel: css`
    flex-shrink: 0;
    width: 280px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    @media (width <= 900px) {
      display: none;
    }
  `,
  prompt: css`
    height: 96px;
    border: 1px solid ${cssVar.colorFill};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgElevated};
  `,
}));

const GenerationSkeleton = () => (
  <Flexbox aria-busy horizontal flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
    <Flexbox className={styles.panel} gap={20} padding={16}>
      {Array.from({ length: 4 }).map((_, index) => (
        <Flexbox gap={8} key={index}>
          <SkeletonBar height={12} width={72 + (index % 2) * 32} />
          <SkeletonBar height={32} radius={cssVar.borderRadius} />
        </Flexbox>
      ))}
    </Flexbox>
    <Flexbox flex={1} justify={'space-between'} padding={16} style={{ minWidth: 0 }}>
      <Grid gap={12} maxItemWidth={200} rows={2} width={'100%'}>
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonBar height={200} key={index} radius={cssVar.borderRadiusLG} />
        ))}
      </Grid>
      <div className={styles.prompt} />
    </Flexbox>
  </Flexbox>
);

export default GenerationSkeleton;
