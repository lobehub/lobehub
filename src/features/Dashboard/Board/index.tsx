'use client';

import { Center, Empty, Flexbox } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { LayoutDashboardIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { usePermission } from '@/hooks/usePermission';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { resolveLayouts, sortByPosition } from '../utils/layout';
import { isUsableRunStatus } from '../utils/widgetHealth';
import WidgetDetailDrawer from '../WidgetDetail';
import BoardHeader from './BoardHeader';
import BoardWidgetCard from './BoardWidgetCard';
import LayoutEditor from './LayoutEditor';
import { cellStyle, gridStyles } from './style';

export interface DashboardBoardProps {
  dashboardId: string;
  /** Shown when the board has no widgets; hosts explain how widgets get here. */
  empty?: React.ReactNode;
}

/**
 * A board's widget grid: cards laid out from `dashboard_items.layout`, manual
 * refresh, layout editing and the per-widget drill-down. Hosts (home page,
 * project page, portal) mount it with a dashboard id and add their own chrome.
 */
const DashboardBoard = memo<DashboardBoardProps>(({ dashboardId, empty }) => {
  const { t } = useTranslation('dashboard');
  const useFetchDashboardDetail = useDashboardStore((s) => s.useFetchDashboardDetail);
  const runWidget = useDashboardStore((s) => s.runWidget);
  const { data, error, isLoading, mutate } = useFetchDashboardDetail(dashboardId);
  const detail = useDashboardStore(dashboardSelectors.dashboardDetail(dashboardId));
  const userId = useUserStore(userProfileSelectors.userId);
  const { allowed: canWrite } = usePermission('create_content');
  const canEditLayout = useDashboardStore(
    dashboardSelectors.canManageDashboard(dashboardId, userId, canWrite),
  );

  const [editing, setEditing] = useState(false);
  const [openWidgetId, setOpenWidgetId] = useState<string>();
  const [refreshingAll, setRefreshingAll] = useState(false);

  const items = detail?.items;
  // `data` is the raw server response — an older deployment may not send
  // `items` yet, so normalize once before any dereference.
  const responseItems = data?.items ?? [];
  const { layouts, ordered } = useMemo(() => {
    const entries = items ?? [];
    const resolved = resolveLayouts(
      entries.map(({ item, widget }) => ({
        id: item.id,
        layout: item.layout,
        outputType: widget.latestOutput?.type,
      })),
    );
    return {
      layouts: resolved,
      ordered: sortByPosition(
        entries.map((entry) => ({ ...entry, id: entry.item.id })),
        resolved,
      ),
    };
  }, [items]);

  const openWidget = items?.find(({ widget }) => widget.id === openWidgetId)?.widget;
  const runnable = ordered.filter(({ widget }) => !!widget.publishedVersionId);

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      const results = await Promise.allSettled(runnable.map(({ widget }) => runWidget(widget.id)));
      const failed = results.filter(
        (result) =>
          result.status === 'rejected' ||
          (result.value !== undefined && !isUsableRunStatus(result.value.status)),
      ).length;
      if (failed > 0) toast.error(t('board.refreshAllFailed', { count: failed }));
    } finally {
      setRefreshingAll(false);
    }
  };

  return (
    <AsyncBoundary
      data={data}
      error={error}
      isEmpty={responseItems.length === 0}
      isLoading={isLoading}
      empty={
        empty ?? (
          <Center flex={1} padding={48}>
            <Empty description={t('board.empty')} icon={LayoutDashboardIcon} />
          </Center>
        )
      }
      onRetry={() => void mutate()}
    >
      {editing && canEditLayout ? (
        <LayoutEditor
          dashboardId={dashboardId}
          initialLayouts={layouts}
          items={ordered}
          onDone={() => setEditing(false)}
        />
      ) : (
        <Flexbox gap={20}>
          <BoardHeader
            description={detail?.description}
            refreshingAll={refreshingAll}
            runnableCount={runnable.length}
            title={detail?.title}
            widgets={ordered.map(({ widget }) => widget)}
            onEditLayout={canEditLayout ? () => setEditing(true) : undefined}
            onRefreshAll={() => void handleRefreshAll()}
          />
          <div className={gridStyles.grid} data-dashboard-grid={'view'}>
            {ordered.map(({ item, widget }) => (
              <div
                className={gridStyles.cell}
                data-layout-cell={item.id}
                key={item.id}
                style={cellStyle(layouts[item.id])}
              >
                <BoardWidgetCard widget={widget} onOpen={setOpenWidgetId} />
              </div>
            ))}
          </div>
        </Flexbox>
      )}
      <WidgetDetailDrawer widget={openWidget} onClose={() => setOpenWidgetId(undefined)} />
    </AsyncBoundary>
  );
});

DashboardBoard.displayName = 'DashboardBoard';

export default DashboardBoard;
