'use client';

import { createStaticStyles, cssVar, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SkeletonBar from '@/components/Skeleton/Bar';

import DeviceGrid from './DeviceGrid';
import { UsageMeterSkeleton } from './DeviceHealth/UsageMeter';

const styles = createStaticStyles(({ css }) => ({
  // Same frame and sections as `DeviceCard`.
  body: css`
    padding-block: 20px 16px;
    padding-inline: 20px;
  `,
  card: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  footer: css`
    margin-block-start: auto;
    padding-block: 12px;
    padding-inline: 20px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  infoGrid: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
  `,
  meterGroup: css`
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr) 36px;
    gap: 8px 12px;
    align-items: center;
  `,
  // Always two rows of cards, whatever the column count the grid steps to.
  twoRows: css`
    & > :nth-child(n + 3) {
      display: none;
    }

    @container device-grid (min-width: 560px) {
      & > :nth-child(n + 3) {
        display: flex;
      }

      & > :nth-child(n + 5) {
        display: none;
      }
    }

    @container device-grid (min-width: 880px) {
      & > :nth-child(n + 5) {
        display: flex;
      }

      & > :nth-child(n + 7) {
        display: none;
      }
    }

    @container device-grid (min-width: 1200px) {
      & > :nth-child(n + 7) {
        display: flex;
      }
    }
  `,
}));

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

const CardSkeleton = () => (
  <div className={styles.card}>
    <Flexbox className={styles.body} gap={20}>
      <Flexbox horizontal align={'flex-start'} gap={16}>
        <SkeletonBar height={48} radius={12} width={48} />
        <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
          <Line barHeight={16} height={24} width={'60%'} />
          <Line barHeight={12} height={20} width={'36%'} />
        </Flexbox>
      </Flexbox>
      <div className={styles.infoGrid}>
        {Array.from({ length: 2 }, (_, index) => (
          <Flexbox gap={4} key={index} style={{ minWidth: 0 }}>
            <Line barHeight={12} height={20} width={'56%'} />
            <Line barHeight={12} height={20} width={'72%'} />
          </Flexbox>
        ))}
      </div>
      <div className={styles.meterGroup}>
        <UsageMeterSkeleton />
        <UsageMeterSkeleton />
      </div>
    </Flexbox>
    <Flexbox horizontal align={'center'} className={styles.footer} gap={8}>
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
  <DeviceGrid className={styles.twoRows}>
    {Array.from({ length: 8 }, (_, index) => (
      <CardSkeleton key={index} />
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
