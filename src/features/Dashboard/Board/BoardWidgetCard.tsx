'use client';

import type { WidgetView } from '@lobechat/types';
import { memo } from 'react';

import type { DashboardWidgetItem } from '@/services/dashboard';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import { useWidgetTrend } from '../hooks/useWidgetTrend';
import WidgetCard from '../WidgetCard';
import WidgetRefreshButton from '../WidgetRefreshButton';

interface BoardWidgetCardProps {
  onOpen: (widgetId: string) => void;
  /** The published version's view; null before the first publish. */
  view?: WidgetView | null;
  widget: DashboardWidgetItem;
}

/** A widget card wired to the board: live trend, manual refresh and drill-down. */
const BoardWidgetCard = memo<BoardWidgetCardProps>(({ view, widget, onOpen }) => {
  const trend = useWidgetTrend(widget);
  const running = useDashboardStore(dashboardSelectors.isWidgetRunning(widget.id));

  return (
    <WidgetCard
      actions={<WidgetRefreshButton widget={widget} />}
      runningLocally={running}
      trend={trend}
      view={view}
      widget={widget}
      onOpen={() => onOpen(widget.id)}
    />
  );
});

BoardWidgetCard.displayName = 'DashboardBoardWidgetCard';

export default BoardWidgetCard;
