'use client';

import { AreaChart, Tracker } from '@lobehub/charts';
import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import { buildHealthTimeline, groupStripBlocks, type HealthSlot } from './buildHealthTimeline';
import { formatPercent, usageLevel } from './format';
import {
  blockColor,
  formatClock as time,
  usageTextColor,
  useBlockTooltip,
  useDeviceMetricSeries,
} from './shared';
import { healthViewState } from './viewState';

export { HealthLegend } from './shared';

/** Status-strip block width: wide enough to see and hover in the side panel. */
const STRIP_BLOCK_MS = 15 * 60_000;

interface MetricChartProps {
  ceiling: number;
  data: { time: string; value: number | null }[];
  label: string;
  latest: number | null | undefined;
}

/** Left: what is measured (with its size); right: the latest share, colored by level. */
const MetricChart = ({ ceiling, data, label, latest }: MetricChartProps) => (
  <Flexbox gap={4}>
    <Flexbox horizontal align={'baseline'} distribution={'space-between'}>
      <Text fontSize={12} type={'secondary'}>
        {label}
      </Text>
      <Text fontSize={12} style={{ color: usageTextColor(usageLevel(latest)) }} weight={500}>
        {formatPercent(latest)}
      </Text>
    </Flexbox>
    <AreaChart
      startEndOnly
      categories={['value']}
      customCategories={{ value: label }}
      data={data}
      height={72}
      index={'time'}
      showLegend={false}
      showYAxis={false}
      valueFormatter={formatPercent}
      yAxisDomain={[0, ceiling]}
    />
  </Flexbox>
);

/**
 * The machine's CPU / memory / load over the recent window, with a status
 * strip colored by how loaded the machine was and telling apart "running but
 * disconnected" from "not running at all" — what a user needs to explain why
 * a device dropped.
 */
const DeviceHealth = ({ deviceId }: { deviceId: string }) => {
  const { t } = useTranslation('setting');
  const { data, error, isValidating, mutate } = useDeviceMetricSeries(deviceId);
  const blockTooltip = useBlockTooltip();

  const view = healthViewState({ data, error });

  // A failed read (gateway down or not yet upgraded) must not look like loading.
  if (view === 'error') {
    return (
      <Flexbox horizontal align={'center'} gap={8}>
        <Text fontSize={12} type={'secondary'}>
          {t('devices.health.error')}
        </Text>
        <Button loading={isValidating} size={'small'} onClick={() => mutate()}>
          {t('devices.health.retry')}
        </Button>
      </Flexbox>
    );
  }

  if (view === 'loading' || !data) {
    return (
      <Text fontSize={12} type={'secondary'}>
        {t('devices.health.loading')}
      </Text>
    );
  }

  if (view === 'empty') {
    return (
      <Text fontSize={12} type={'secondary'}>
        {t('devices.health.empty')}
      </Text>
    );
  }

  const timeline = buildHealthTimeline(data);
  const rows = (pick: (slot: HealthSlot) => number | null) =>
    timeline.slots.map((slot) => ({ time: time(slot.start), value: pick(slot) }));
  const cores = data.cpuCount ?? 1;

  return (
    <Flexbox gap={16}>
      <Flexbox gap={6}>
        {/* Blocks flex to an equal share of the panel — the default fixed
            12px overflowed and clipped the newest hours. */}
        <Tracker
          blockGap={2}
          blockHeight={16}
          blockWidth={'100%'}
          width={'100%'}
          data={groupStripBlocks(
            timeline.slots,
            data.bucketMs,
            Math.max(data.bucketMs, STRIP_BLOCK_MS),
          ).map((block) => ({
            color: blockColor(block),
            key: block.start,
            tooltip: blockTooltip(block),
          }))}
        />
        <Flexbox horizontal distribution={'space-between'}>
          <Text fontSize={11} type={'secondary'}>
            {time(data.from)}
          </Text>
          <Text fontSize={11} type={'secondary'}>
            {t('devices.health.now')}
          </Text>
        </Flexbox>
      </Flexbox>

      <MetricChart
        ceiling={100}
        data={rows((slot) => slot.cpuPercent)}
        label={t('devices.health.cpuCores', { count: cores })}
        latest={timeline.latest?.cpuPercent}
      />
      <MetricChart
        ceiling={100}
        data={rows((slot) => slot.memoryPercent)}
        latest={timeline.latest?.memoryPercent}
        label={
          data.memoryTotalBytes
            ? `${t('devices.health.memory')} · ${formatSize(data.memoryTotalBytes)}`
            : t('devices.health.memory')
        }
      />
      {timeline.slots.some((slot) => slot.loadPercent !== null) && (
        <MetricChart
          ceiling={timeline.loadCeiling}
          data={rows((slot) => slot.loadPercent)}
          label={t('devices.health.load', { count: cores })}
          latest={timeline.latest?.loadPercent}
        />
      )}
    </Flexbox>
  );
};

export default DeviceHealth;
