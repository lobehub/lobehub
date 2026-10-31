'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useSize } from 'ahooks';
import { type ReactNode, useRef } from 'react';

import SkeletonBar from '@/components/Skeleton/Bar';

import { formatPercent, usageLevel } from './format';
import { USAGE_COLOR, usageTextColor } from './shared';

/**
 * Whole-pixel tick geometry. Splitting the bar into a fixed tick count gives
 * fractional widths that the browser snaps to alternating 3px / 4px ticks, so
 * the count follows the bar width instead.
 */
const SEGMENT_WIDTH = 3;
const SEGMENT_GAP = 1;

/** Ticks that fit a bar of `width` px. */
export const segmentCount = (width: number) =>
  Math.max(0, Math.floor((width + SEGMENT_GAP) / (SEGMENT_WIDTH + SEGMENT_GAP)));

const styles = stylex.create({
  bar: { display: 'flex', flex: 'none', gap: `${SEGMENT_GAP}px`, width: '100%', minWidth: '0' },
  group: {
    display: 'grid',
    gridTemplateColumns: 'max-content minmax(0, 1fr) 36px',
    rowGap: '8px',
    columnGap: '12px',
    alignItems: 'center',
  },
  segment: { flex: 'none', width: `${SEGMENT_WIDTH}px`, borderRadius: '1px' },
});

/** Lit ticks for a reading: any non-zero usage lights at least one, so a running machine never reads as empty. */
export const litSegments = (value: number | null | undefined, segments: number) => {
  if (segments <= 0 || value === null || value === undefined || value <= 0) return 0;
  return Math.min(segments, Math.max(1, Math.round((value / 100) * segments)));
};

interface UsageBarProps {
  /** Bar height in px. */
  height?: number;
  value: number | null | undefined;
}

/**
 * The segmented bar alone, colored by the normal / high / critical thresholds.
 * No reading keeps every segment unlit.
 */
export const UsageBar = ({ height = 12, value }: UsageBarProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const segments = segmentCount(size?.width ?? 0);
  const level = usageLevel(value);
  const lit = litSegments(value, segments);
  const color = level ? USAGE_COLOR[level] : cssVar.colorFillSecondary;

  return (
    <div aria-hidden className={stylex.props(styles.bar).className} ref={ref} style={{ height }}>
      {Array.from({ length: segments }, (_, i) => (
        <span
          className={stylex.props(styles.segment).className}
          key={i}
          style={{ background: i < lit ? color : cssVar.colorFillSecondary }}
        />
      ))}
    </div>
  );
};

interface UsageMeterProps {
  label: string;
  value: number | null | undefined;
}

export const UsageMeterGroup = ({
  children,
  loading,
}: {
  children: ReactNode;
  loading?: boolean;
}) => (
  <div aria-busy={loading || undefined} {...stylex.props(styles.group)}>
    {children}
  </div>
);

/** A text-line placeholder centered in the 20px line box of the meter's label / value. */
const SkeletonLine = ({ width }: { width: number }) => (
  <Flexbox justify={'center'} style={{ height: 20, minWidth: 0 }}>
    <SkeletonBar height={12} width={width} />
  </Flexbox>
);

/**
 * Placeholder for one {@link UsageMeter} while its reading loads, in the same
 * three grid cells and row height so the card keeps its height on loading →
 * loaded. The label column still settles to the real label's width.
 */
export const UsageMeterSkeleton = () => (
  <>
    <SkeletonLine width={72} />
    <SkeletonBar height={12} />
    <SkeletonLine width={28} />
  </>
);

/**
 * One labelled usage reading as a segmented bar, colored by the same
 * normal / high / critical thresholds as the health strip. No reading keeps
 * the bar unlit and the value as an em dash, so a card keeps its height
 * whether or not the device has reported. Render inside {@link UsageMeterGroup}.
 */
const UsageMeter = ({ label, value }: UsageMeterProps) => {
  const level = usageLevel(value);

  return (
    <>
      <Text fontSize={13} style={{ whiteSpace: 'nowrap' }} type={'secondary'}>
        {label}
      </Text>
      <UsageBar value={value} />
      <Text
        fontSize={13}
        style={{ color: usageTextColor(level), textAlign: 'end' }}
        type={level ? undefined : 'secondary'}
      >
        {formatPercent(value)}
      </Text>
    </>
  );
};

export default UsageMeter;
