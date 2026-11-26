'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import SkeletonBar from '@/components/Skeleton/Bar';
import { densityTokens } from '@/styles/density.stylex';

const styles = stylex.create({
  // `Connections` card: filled, rows 10px apart from its 2px inset.
  connections: {
    paddingBlock: '2px',
    paddingInline: densityTokens['--lobe-density-card-padding'],
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
});

const Line = ({ bar, height, width }: { bar: number; height: number; width: number | string }) => (
  <Flexbox height={height} justify={'center'} style={{ minWidth: 0 }}>
    <SkeletonBar height={bar} width={width} />
  </Flexbox>
);

/** A connection section before its lookup settles: heading, action and one row. */
export const IntegrationConnectionsSkeleton = ({ title }: { title?: string }) => (
  <Flexbox aria-busy gap={10}>
    <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
      {title ? (
        <Text strong style={{ fontSize: 16 }}>
          {title}
        </Text>
      ) : (
        <Line bar={16} height={24} width={96} />
      )}
      <SkeletonBar height={24} width={88} />
    </Flexbox>
    <div {...stylex.props(styles.connections)}>
      <Flexbox horizontal align={'center'} gap={12} paddingBlock={10}>
        <SkeletonBar height={36} radius={'50%'} width={36} />
        <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
          <Line bar={14} height={22} width={120} />
          <Line bar={12} height={22} width={'48%'} />
        </Flexbox>
        <Line bar={14} height={30} width={72} />
      </Flexbox>
    </div>
  </Flexbox>
);
