'use client';

import { createStaticStyles, cx } from 'antd-style';
import dayjs from 'dayjs';
import { type ReactNode } from 'react';
import { memo, useMemo } from 'react';
import { GroupedVirtuoso } from 'react-virtuoso';

import Loading from '@/app/[variants]/(main)/memory/features/Loading';
import { useIsDark } from '@/hooks/useIsDark';

import { useScrollParent } from './useScrollParent';

const styles = createStaticStyles(({ css, cssVar }) => ({
  timelineContainer: css`
    position: relative;
    height: 100%;
  `,
  timelineLine: css`
    position: absolute;
    inset-block: 0;
    inset-inline-start: 8px;

    width: 1px;
    height: 100%;

    background: ${cssVar.colorFillSecondary};
  `,
  timelineLine_dark: css`
    background: ${cssVar.colorFillQuaternary};
  `,
}));

export type GroupBy = 'day' | 'month';

interface TimelineViewProps<
  T extends { capturedAt?: Date | string; createdAt?: Date | string; id: string },
> {
  data: T[];
  /**
   * Custom date field extractor for grouping
   * Used when the date to group by is not `capturedAt`
   */
  getDateForGrouping?: (item: T) => Date | string;
  /**
   * Group items by 'day' (YYYY-MM-DD) or 'month' (YYYY-MM)
   * @default 'day'
   */
  groupBy?: GroupBy;
  /**
   * Whether there are more items to load
   */
  hasMore?: boolean;
  /**
   * Whether data is currently loading
   */
  isLoading?: boolean;
  /**
   * Callback when end is reached
   */
  onLoadMore?: () => void;
  renderHeader: (periodKey: string, itemCount: number) => ReactNode;
  renderItem: (item: T) => ReactNode;
}

const getDateValue = <T extends { capturedAt?: Date | string; createdAt?: Date | string }>(
  item: T,
  getDateForGrouping?: (item: T) => Date | string,
) => {
  if (getDateForGrouping) return getDateForGrouping(item);

  return item.capturedAt ?? item.createdAt ?? new Date();
};

function TimelineViewInner<
  T extends { capturedAt?: Date | string; createdAt?: Date | string; id: string },
>({
  data,
  groupBy = 'day',
  getDateForGrouping,
  hasMore,
  isLoading,
  onLoadMore,
  renderHeader,
  renderItem,
}: TimelineViewProps<T>) {
  const isDarkMode = useIsDark();
  const scrollParent = useScrollParent();

  const { groupCounts, sortedPeriods, groupedItems } = useMemo(() => {
    const format = groupBy === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';

    // Group by period
    const groupedByPeriod = data.reduce(
      (acc, item) => {
        const dateValue = getDateValue(item, getDateForGrouping);
        const date = dayjs(dateValue);
        const periodKey = date.format(format);

        if (!acc[periodKey]) {
          acc[periodKey] = [];
        }
        acc[periodKey].push(item);
        return acc;
      },
      {} as Record<string, T[]>,
    );

    // Sort periods descending
    const periods = Object.keys(groupedByPeriod).sort((a, b) => b.localeCompare(a));

    // Create group counts and sorted items
    const counts: number[] = [];
    const items: T[] = [];

    for (const periodKey of periods) {
      const periodData = groupedByPeriod[periodKey];

      // Sort items within period by date descending
      const sortedItems = [...periodData].sort((a, b) => {
        const dateA = getDateValue(a, getDateForGrouping);
        const dateB = getDateValue(b, getDateForGrouping);
        return dayjs(dateB).valueOf() - dayjs(dateA).valueOf();
      });

      counts.push(sortedItems.length);
      items.push(...sortedItems);
    }

    return {
      groupCounts: counts,
      groupedItems: items,
      sortedPeriods: periods,
    };
  }, [data, groupBy, getDateForGrouping]);

  if (!data || data.length === 0) {
    return null;
  }

  return (
    <div className={styles.timelineContainer}>
      <div className={cx(styles.timelineLine, isDarkMode && styles.timelineLine_dark)} />
      <GroupedVirtuoso
        customScrollParent={scrollParent}
        endReached={hasMore && onLoadMore ? onLoadMore : undefined}
        groupCounts={groupCounts}
        increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
        overscan={24}
        style={{ minHeight: '100%' }}
        components={{
          Footer: isLoading ? () => <Loading viewMode={'timeline'} /> : undefined,
        }}
        groupContent={(index) => {
          const periodKey = sortedPeriods[index];
          const itemCount = groupCounts[index];
          return renderHeader(periodKey, itemCount);
        }}
        itemContent={(index) => {
          const item = groupedItems[index];
          return renderItem(item);
        }}
      />
    </div>
  );
}

export const TimelineView = memo(TimelineViewInner) as typeof TimelineViewInner;
