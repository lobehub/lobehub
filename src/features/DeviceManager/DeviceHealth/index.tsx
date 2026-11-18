'use client';

import type { DeviceScope } from '@lobechat/types';
import { AreaChart, Tracker } from '@lobehub/charts';
import { Button, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import { buildHealthTimeline, groupStripBlocks, type HealthSlot } from './buildHealthTimeline';
import { formatPercent, LOAD_THRESHOLDS, usageLevel, type UsageThresholds } from './format';
import {
  blockColor,
  formatClock as time,
  usageTextColor,
  useBlockTooltip,
  useDeviceMetricSeries,
} from './shared';
import { healthViewState } from './viewState';

export { HealthLegend } from './shared';

/**
 * Status-strip block span. The strip spans the full-width detail page, so a
 * 5-minute block keeps each tick narrow there (~144 over 12 hours) instead of
 * blowing 48 blocks up into large squares.
 */
const STRIP_BLOCK_MS = 5 * 60_000;

const styles = stylex.create({
  /**
   * Charts side by side, at most two per row: each column is at least half
   * the row, so a third chart wraps instead of squeezing in, and a row too
   * narrow for two 320px charts falls back to one column, which itself
   * shrinks to the row when the row is under 320px.
   */
  charts: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns:
      'repeat(auto-fill, minmax(max(min(100%, 320px), calc((100% - 16px) / 2)), 1fr))',
  },
});

interface MetricChartProps {
  ceiling: number;
  data: { time: string; value: number | null }[];
  label: string;
  latest: number | null | undefined;
  thresholds?: UsageThresholds;
}

/** Left: what is measured (with its size); right: the latest share, colored by level. */
const MetricChart = ({ ceiling, data, label, latest, thresholds }: MetricChartProps) => (
  <Flexbox gap={4}>
    <Flexbox horizontal align={'baseline'} distribution={'space-between'}>
      <Text fontSize={12} type={'secondary'}>
        {label}
      </Text>
      <Text
        fontSize={12}
        style={{ color: usageTextColor(usageLevel(latest, thresholds)) }}
        weight={500}
      >
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
const DeviceHealth = ({ deviceId, scope }: { deviceId: string; scope: DeviceScope }) => {
  const { t } = useTranslation('setting');
  const { data, error, isValidating, mutate } = useDeviceMetricSeries(deviceId, scope);
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
        {/* Blocks flex to an equal share of the width — the default fixed
            12px overflowed and clipped the newest hours. Thin ticks with a 1px
            gap match the usage bars above. */}
        <Tracker
          blockGap={1}
          blockHeight={12}
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

      <div {...stylex.props(styles.charts)}>
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
            thresholds={LOAD_THRESHOLDS}
          />
        )}
      </div>
    </Flexbox>
  );
};

export default DeviceHealth;
