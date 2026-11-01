'use client';

import { ActionIcon, toast } from '@lobehub/ui';
import { RefreshCwIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import type { DashboardWidgetItem } from '@/services/dashboard';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import { isUsableRunStatus } from './utils/widgetHealth';

/**
 * Run the widget's published version now. Hidden until a version is published —
 * there is nothing to run before that, and hidden entirely without the
 * create_content permission — refreshing is a write the server refuses for
 * workspace viewers.
 */
const WidgetRefreshButton = memo<{ widget: DashboardWidgetItem }>(({ widget }) => {
  const { t } = useTranslation('dashboard');
  const runWidget = useDashboardStore((s) => s.runWidget);
  const running = useDashboardStore(dashboardSelectors.isWidgetRunning(widget.id));
  const { allowed } = usePermission('create_content');

  if (!widget.publishedVersionId || !allowed) return null;

  const handleRefresh = async () => {
    try {
      const run = await runWidget(widget.id);
      if (run && !isUsableRunStatus(run.status)) {
        toast.error(
          t('widget.refresh.failed', {
            message: run.error?.message ?? t(`run.status.${run.status}`),
          }),
        );
      }
    } catch (error) {
      toast.error(
        t('widget.refresh.failed', { message: error instanceof Error ? error.message : '' }),
      );
    }
  };

  return (
    <ActionIcon
      data-widget-refresh
      aria-label={t('widget.refresh.action')}
      icon={RefreshCwIcon}
      loading={running || widget.lastRunStatus === 'running'}
      size={'small'}
      title={t('widget.refresh.action')}
      onClick={() => void handleRefresh()}
    />
  );
});

WidgetRefreshButton.displayName = 'DashboardWidgetRefreshButton';

export default WidgetRefreshButton;
