'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { type GroupBy } from './index';

const styles = stylex.create({
  itemWrapper: { position: 'relative', paddingInlineStart: '24px' },
  periodHeader: {
    position: 'sticky',
    zIndex: 10,
    insetBlockStart: '0',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  timelineDot: {
    position: 'absolute',
    insetBlockStart: '20px',
    insetInlineStart: '0',
    width: '16px',
    height: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '50%',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: '0 2px 4px -2px rgb(0 0 0 / 40%)',
  },
});

interface PeriodHeaderProps {
  groupBy?: GroupBy;

  periodKey: string;
}

export const PeriodHeader = memo<PeriodHeaderProps>(({ periodKey, groupBy = 'day' }) => {
  const periodName =
    groupBy === 'month'
      ? dayjs(`${periodKey}-01`).format('MMMM YYYY')
      : dayjs(periodKey).format('MMMM D, YYYY');

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.periodHeader).className}
      gap={12}
      paddingBlock={8}
    >
      <Text weight={500}>{periodName}</Text>
    </Flexbox>
  );
});

interface TimelineItemWrapperProps {
  children: ReactNode;
}

export const TimelineItemWrapper = memo<TimelineItemWrapperProps>(({ children }) => {
  return (
    <div {...stylex.props(styles.itemWrapper)}>
      <div {...stylex.props(styles.timelineDot)} />
      {children}
    </div>
  );
});
