'use client';

import type { WidgetOutput, WidgetView as WidgetViewHints } from '@lobechat/types';
import { memo } from 'react';

import type { DashboardTrendSeries } from '@/services/dashboard';

import ListView from './ListView';
import SeriesView from './SeriesView';
import StatView from './StatView';
import TableView from './TableView';

export interface WidgetOutputViewProps {
  /** `compact` applies the view's row limit (cards); `full` shows everything (drill-down). */
  density?: 'compact' | 'full';
  output: WidgetOutput;
  trend?: DashboardTrendSeries[];
  view?: WidgetViewHints | null;
}

/** Card row cap when the version sets no `view.limit`. */
const COMPACT_ROW_LIMIT = 8;

/** Render one widget output by its contract type. */
const WidgetOutputView = memo<WidgetOutputViewProps>(
  ({ output, trend, view, density = 'compact' }) => {
    const limit = density === 'compact' ? (view?.limit ?? COMPACT_ROW_LIMIT) : undefined;

    switch (output.type) {
      case 'stat': {
        return <StatView output={output} trend={trend} />;
      }
      case 'list': {
        return <ListView limit={limit} output={output} />;
      }
      case 'series': {
        return (
          <SeriesView
            chart={view?.chart}
            height={density === 'full' ? 280 : '100%'}
            output={output}
            trend={trend}
          />
        );
      }
      case 'table': {
        return <TableView columns={view?.columns} limit={limit} output={output} />;
      }
      default: {
        return null;
      }
    }
  },
);

WidgetOutputView.displayName = 'DashboardWidgetOutputView';

export default WidgetOutputView;
