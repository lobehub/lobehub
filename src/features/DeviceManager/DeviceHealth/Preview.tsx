'use client';

import { Tracker } from '@lobehub/charts';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { buildHealthTimeline, groupStripBlocks } from './buildHealthTimeline';
import { formatPercent, usageLevel } from './format';
import { blockColor, usageTextColor, useBlockTooltip, useDeviceMetricSeries } from './shared';

/** Half-hour blocks: 24 across the 12-hour window, enough to spot a drop at a glance. */
const PREVIEW_BLOCK_MS = 30 * 60_000;
const PREVIEW_WIDTH = 168;

/**
 * At-a-glance health for a device-list row, before the detail panel is
 * opened: a mini status strip plus the latest CPU / memory / load, each
 * colored by how loaded it is. Renders nothing for a device that never
 * reported.
 */
const DeviceHealthPreview = ({ deviceId }: { deviceId: string }) => {
  const { t } = useTranslation('setting');
  const { data } = useDeviceMetricSeries(deviceId);
  const blockTooltip = useBlockTooltip();

  if (!data || data.points.length === 0) return null;

  const timeline = buildHealthTimeline(data);
  const blocks = groupStripBlocks(
    timeline.slots,
    data.bucketMs,
    Math.max(data.bucketMs, PREVIEW_BLOCK_MS),
  );
  const readings = [
    { label: t('devices.health.cpu'), value: timeline.latest?.cpuPercent },
    { label: t('devices.health.memory'), value: timeline.latest?.memoryPercent },
    { label: t('devices.health.loadShort'), value: timeline.latest?.loadPercent },
  ];

  return (
    <Flexbox gap={4} style={{ flex: 'none', width: PREVIEW_WIDTH }}>
      <Tracker
        blockGap={1}
        blockHeight={10}
        blockWidth={'100%'}
        width={'100%'}
        data={blocks.map((block) => ({
          color: blockColor(block),
          key: block.start,
          tooltip: blockTooltip(block),
        }))}
      />
      <Flexbox horizontal distribution={'space-between'}>
        {readings.map(({ label, value }) => (
          <Text fontSize={11} key={label} type={'secondary'}>
            {label}{' '}
            <span style={{ color: usageTextColor(usageLevel(value)) }}>{formatPercent(value)}</span>
          </Text>
        ))}
      </Flexbox>
    </Flexbox>
  );
};

export default DeviceHealthPreview;
