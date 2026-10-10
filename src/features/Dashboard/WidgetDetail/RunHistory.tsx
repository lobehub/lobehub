'use client';

import { createStaticStyles, cssVar, cx,Flexbox, Icon, Tag, Text   } from '@lobehub/ui';
import dayjs from 'dayjs';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import type { DashboardWidgetRunItem } from '@/services/dashboard';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import { formatDuration } from '../utils/format';
import RunLogs from './RunLogs';

const RUN_STATUS_COLOR: Record<string, string> = {
  failed: 'error',
  running: 'processing',
  succeeded: 'success',
  timeout: 'warning',
};

const styles = createStaticStyles(({ css }) => ({
  row: css`
    cursor: pointer;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  rowActive: css`
    background: ${cssVar.colorFillTertiary};
  `,
}));

const RunRow = memo<{ run: DashboardWidgetRunItem; versionNumber?: number }>(
  ({ run, versionNumber }) => {
    const { t } = useTranslation('dashboard');
    const [open, setOpen] = useState(false);
    const duration = formatDuration(run.durationMs);

    return (
      <Flexbox gap={8}>
        <Flexbox
          horizontal
          align={'center'}
          className={cx(styles.row, open && styles.rowActive)}
          data-run-id={run.id}
          gap={8}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon icon={open ? ChevronDownIcon : ChevronRightIcon} size={14} />
          <Tag color={RUN_STATUS_COLOR[run.status]} size={'small'}>
            {t(`run.status.${run.status}`)}
          </Tag>
          <Text fontSize={12} type={'secondary'}>
            {t(`run.trigger.${run.trigger}`)}
          </Text>
          {versionNumber !== undefined && (
            <Text fontSize={12} type={'secondary'}>
              {`v${versionNumber}`}
            </Text>
          )}
          <Flexbox flex={1} />
          {duration && (
            <Text fontSize={12} type={'secondary'}>
              {duration}
            </Text>
          )}
          <Text
            fontSize={12}
            title={dayjs(run.startedAt).format('YYYY-MM-DD HH:mm:ss')}
            type={'secondary'}
          >
            {dayjs(run.startedAt).fromNow()}
          </Text>
        </Flexbox>
        {open && (
          <Flexbox paddingInline={8}>
            <RunLogs run={run} />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

RunRow.displayName = 'DashboardRunRow';

/** Recent runs of a widget, newest first; each expands into its logs. */
const RunHistory = memo<{ widgetId: string }>(({ widgetId }) => {
  const { t } = useTranslation('dashboard');
  const useFetchWidgetRuns = useDashboardStore((s) => s.useFetchWidgetRuns);
  const useFetchWidgetVersions = useDashboardStore((s) => s.useFetchWidgetVersions);
  const { data, error, isLoading, mutate } = useFetchWidgetRuns(widgetId);
  useFetchWidgetVersions(widgetId);
  const runs = useDashboardStore(dashboardSelectors.widgetRuns(widgetId));
  const versions = useDashboardStore(dashboardSelectors.widgetVersions(widgetId));
  const versionNumberById = new Map(versions.map((version) => [version.id, version.version]));

  return (
    <AsyncBoundary
      data={data}
      error={error}
      isEmpty={data?.length === 0}
      isLoading={isLoading}
      empty={
        <Text fontSize={12} type={'secondary'}>
          {t('run.empty')}
        </Text>
      }
      onRetry={() => void mutate()}
    >
      <Flexbox gap={2}>
        {runs.map((run) => (
          <RunRow key={run.id} run={run} versionNumber={versionNumberById.get(run.versionId)} />
        ))}
      </Flexbox>
    </AsyncBoundary>
  );
});

RunHistory.displayName = 'DashboardRunHistory';

export default RunHistory;
