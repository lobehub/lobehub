'use client';

import type { WidgetView } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardWidgetRunItem } from '@/services/dashboard';

import { formatDuration } from '../utils/format';
import WidgetOutputView from '../WidgetCard/views';
import RunLogs from './RunLogs';

const RUN_STATUS_COLOR: Record<string, string> = {
  failed: 'error',
  running: 'processing',
  succeeded: 'success',
  timeout: 'warning',
};

interface WidgetRunPreviewProps {
  run: DashboardWidgetRunItem;
  view?: WidgetView | null;
}

/** One run in full: its complete output (no row cap), then its error and logs. */
const WidgetRunPreview = memo<WidgetRunPreviewProps>(({ run, view }) => {
  const { t } = useTranslation('dashboard');

  return (
    <Flexbox data-run-preview={run.id} gap={12}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Tag color={RUN_STATUS_COLOR[run.status]} size={'small'}>
          {t(`run.status.${run.status}`)}
        </Tag>
        <Text fontSize={12} type={'secondary'}>
          {[
            t(`run.trigger.${run.trigger}`),
            formatDuration(run.durationMs),
            dayjs(run.startedAt).format('YYYY-MM-DD HH:mm:ss'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </Flexbox>
      {run.output && (
        <div style={{ minHeight: 120 }}>
          <WidgetOutputView density={'full'} output={run.output} view={view} />
        </div>
      )}
      <RunLogs run={run} />
    </Flexbox>
  );
});

WidgetRunPreview.displayName = 'DashboardWidgetRunPreview';

export default WidgetRunPreview;
