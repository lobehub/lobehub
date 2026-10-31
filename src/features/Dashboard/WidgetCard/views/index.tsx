'use client';

import type { WidgetOutput, WidgetView as WidgetViewHints } from '@lobechat/types';
import { memo } from 'react';

import type { DashboardTrendSeries } from '@/services/dashboard';

import DataView from './DataView';
import LayoutView from './LayoutView';
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

/** Render one widget output by its version's layout, else by its contract type. */
const WidgetOutputView = memo<WidgetOutputViewProps>(
  ({ output, trend, view, density = 'compact' }) => {
    // Cards scroll and load rows as needed; only an explicit `view.limit` caps them.
    const compact = density === 'compact';
    const limit = compact ? view?.limit : undefined;

    if (view?.layout) {
      return (
        <LayoutView framed={!compact} layout={view.layout} output={output} surface={view.surface} />
      );
    }

    switch (output.type) {
      case 'stat': {
        return <StatView output={output} trend={trend} />;
      }
      case 'list': {
        return <ListView incremental={compact} limit={limit} output={output} />;
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
        return (
          <TableView columns={view?.columns} incremental={compact} limit={limit} output={output} />
        );
      }
      case 'data': {
        return <DataView output={output} />;
      }
      default: {
        return null;
      }
    }
  },
);

WidgetOutputView.displayName = 'DashboardWidgetOutputView';

export default WidgetOutputView;
