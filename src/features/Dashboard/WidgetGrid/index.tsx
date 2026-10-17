'use client';

import { memo, useMemo, useState } from 'react';

import type { DashboardWidgetItem } from '@/services/dashboard';

import BoardWidgetCard from '../Board/BoardWidgetCard';
import { cellStyle, gridStyles } from '../Board/style';
import { resolveLayouts } from '../utils/layout';
import WidgetDetailDrawer from '../WidgetDetail';

export interface DashboardWidgetGridProps {
  widgets: DashboardWidgetItem[];
}

/**
 * Widgets that are not tied to one board (e.g. everything a project owns),
 * packed at their default sizes in the board grid, with refresh and drill-down.
 */
const DashboardWidgetGrid = memo<DashboardWidgetGridProps>(({ widgets }) => {
  const [openWidgetId, setOpenWidgetId] = useState<string>();

  const layouts = useMemo(
    () =>
      resolveLayouts(
        widgets.map((widget) => ({ id: widget.id, outputType: widget.latestOutput?.type })),
      ),
    [widgets],
  );

  const openWidget = widgets.find((widget) => widget.id === openWidgetId);

  return (
    <>
      <div className={gridStyles.grid} data-dashboard-grid={'widgets'}>
        {widgets.map((widget) => (
          <div
            className={gridStyles.cell}
            data-widget-id={widget.id}
            key={widget.id}
            style={cellStyle(layouts[widget.id])}
          >
            <BoardWidgetCard widget={widget} onOpen={setOpenWidgetId} />
          </div>
        ))}
      </div>
      <WidgetDetailDrawer widget={openWidget} onClose={() => setOpenWidgetId(undefined)} />
    </>
  );
});

DashboardWidgetGrid.displayName = 'DashboardWidgetGrid';

export default DashboardWidgetGrid;
