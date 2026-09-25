'use client';

import { Tracker } from '@lobehub/charts';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { buildHealthTimeline, groupStripBlocks } from './buildHealthTimeline';
import { formatPercent } from './format';
import { formatClock, SLOT_COLOR, useDeviceMetricSeries, useStatusLabels } from './shared';

/** Half-hour blocks: 24 across the 12-hour window, enough to spot a drop at a glance. */
const PREVIEW_BLOCK_MS = 30 * 60_000;
const PREVIEW_WIDTH = 124;

/**
 * At-a-glance health for a device-list row, before the detail panel is
 * opened: a mini status strip plus the latest CPU / memory. Renders nothing
 * for a device that never reported.
 */
const DeviceHealthPreview = ({ deviceId }: { deviceId: string }) => {
  const { t } = useTranslation('setting');
  const { data } = useDeviceMetricSeries(deviceId);
  const statusLabel = useStatusLabels();

  if (!data || data.points.length === 0) return null;

  const timeline = buildHealthTimeline(data);
  const blocks = groupStripBlocks(
    timeline.slots,
    data.bucketMs,
    Math.max(1, Math.round(PREVIEW_BLOCK_MS / data.bucketMs)),
  );

  return (
    <Flexbox gap={4} style={{ flex: 'none', width: PREVIEW_WIDTH }}>
      <Tracker
        blockGap={1}
        blockHeight={10}
        blockWidth={'100%'}
        width={'100%'}
        data={blocks.map((block) => ({
          color: SLOT_COLOR[block.status],
          key: block.start,
          tooltip: `${formatClock(block.start)}–${formatClock(block.end)} · ${statusLabel[block.status]}`,
        }))}
      />
      <Text ellipsis fontSize={11} type={'secondary'}>
        {t('devices.health.preview', {
          cpu: formatPercent(timeline.latest?.cpuPercent),
          memory: formatPercent(timeline.latest?.memoryPercent),
        })}
      </Text>
    </Flexbox>
  );
};

export default DeviceHealthPreview;
