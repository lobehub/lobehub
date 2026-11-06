'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import SkeletonBar from '@/components/Skeleton/Bar';

import DeviceGrid from './DeviceGrid';
import { UsageMeterSkeleton } from './DeviceHealth/UsageMeter';

const styles = stylex.create({
  // Same frame and sections as `DeviceCard`.
  body: { paddingBlockStart: '20px', paddingBlockEnd: '16px', paddingInline: '20px' },
  card: {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  // Always two rows of cards, whatever the column count the grid steps to.
  cardFrom1200: {
    display: {
      'default': 'none',
      '@container device-grid (min-width: 1200px)': 'flex',
    },
  },
  cardFrom560: {
    display: {
      'default': 'none',
      '@container device-grid (min-width: 560px)': 'flex',
    },
  },
  cardFrom880: {
    display: {
      'default': 'none',
      '@container device-grid (min-width: 880px)': 'flex',
    },
  },
  footer: {
    marginBlockStart: 'auto',
    paddingBlock: '12px',
    paddingInline: '20px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  infoGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '16px' },
  meterGroup: {
    display: 'grid',
    gridTemplateColumns: '96px minmax(0, 1fr) 36px',
    rowGap: '8px',
    columnGap: '12px',
    alignItems: 'center',
  },
});

/** A text placeholder centered in the line box of the text it stands in for. */
const Line = ({
  barHeight,
  height,
  width,
}: {
  barHeight: number;
  height: number;
  width: number | string;
}) => (
  <Flexbox justify={'center'} style={{ height, minWidth: 0 }}>
    <SkeletonBar height={barHeight} width={width} />
  </Flexbox>
);

const CardSkeleton = ({ index }: { index: number }) => (
  <div
    {...stylex.props(
      styles.card,
      index >= 6
        ? styles.cardFrom1200
        : index >= 4
          ? styles.cardFrom880
          : index >= 2
            ? styles.cardFrom560
            : undefined,
    )}
  >
    <Flexbox className={stylex.props(styles.body).className} gap={20}>
      <Flexbox horizontal align={'flex-start'} gap={16}>
        <SkeletonBar height={48} radius={12} width={48} />
        <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
          <Line barHeight={16} height={24} width={'60%'} />
          <Line barHeight={12} height={20} width={'36%'} />
        </Flexbox>
      </Flexbox>
      <div {...stylex.props(styles.infoGrid)}>
        {Array.from({ length: 2 }, (_, index) => (
          <Flexbox gap={4} key={index} style={{ minWidth: 0 }}>
            <Line barHeight={12} height={20} width={'56%'} />
            <Line barHeight={12} height={20} width={'72%'} />
          </Flexbox>
        ))}
      </div>
      <div {...stylex.props(styles.meterGroup)}>
        <UsageMeterSkeleton />
        <UsageMeterSkeleton />
      </div>
    </Flexbox>
    <Flexbox horizontal align={'center'} className={stylex.props(styles.footer).className} gap={8}>
      <SkeletonBar height={8} radius={'50%'} width={8} />
      <Line barHeight={12} height={20} width={'48%'} />
    </Flexbox>
  </div>
);

/**
 * Loading placeholder in the card grid's shape — two rows of `DeviceCard`
 * outlines — so loading → loaded is a content swap, not a relayout (ux §4.1).
 */
export const DeviceGridSkeleton = memo(() => (
  <DeviceGrid>
    {Array.from({ length: 8 }, (_, index) => (
      <CardSkeleton index={index} key={index} />
    ))}
  </DeviceGrid>
));

DeviceGridSkeleton.displayName = 'DeviceGridSkeleton';

/**
 * Route fallback for the workspace devices page: the visibility tabs + actions
 * toolbar above the same card grid `DeviceManager` shows while its list loads,
 * so the chunk wait hands over to the data wait without a second skeleton.
 */
const DevicesPageSkeleton = () => (
  <Flexbox aria-busy gap={16}>
    <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
      <SkeletonBar height={36} width={200} />
      <Flexbox horizontal align={'center'} gap={8}>
        <SkeletonBar height={36} width={36} />
        <SkeletonBar height={36} width={140} />
      </Flexbox>
    </Flexbox>
    <DeviceGridSkeleton />
  </Flexbox>
);

export default DevicesPageSkeleton;
