'use client';

import type { DeviceMetricSeries } from '@lobechat/types';
import { AreaChart, Tracker } from '@lobehub/charts';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { deviceService } from '@/services/device';
import { formatSize } from '@/utils/format';

import { buildHealthTimeline, type HealthSlotStatus } from './buildHealthTimeline';

const DEVICE_METRICS_SWR_KEY = 'device/metricSeries';
const REFRESH_INTERVAL_MS = 60_000;

const SLOT_COLOR: Record<HealthSlotStatus, string> = {
  missing: cssVar.colorFillSecondary,
  offline: cssVar.colorWarning,
  online: cssVar.colorSuccess,
  pending: cssVar.colorFillQuaternary,
};

const time = (ms: number) => dayjs(ms).format('HH:mm');
const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${Math.round(value)}%`;

interface MetricChartProps {
  ceiling: number;
  data: { time: string; value: number | null }[];
  format: (value: number) => string;
  label: string;
  latest: string;
}

const MetricChart = ({ ceiling, data, format, label, latest }: MetricChartProps) => (
  <Flexbox gap={4}>
    <Flexbox horizontal align={'baseline'} distribution={'space-between'}>
      <Text fontSize={12} type={'secondary'}>
        {label}
      </Text>
      <Text fontSize={12} weight={500}>
        {latest}
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
      valueFormatter={format}
      yAxisDomain={[0, ceiling]}
    />
  </Flexbox>
);

/**
 * The machine's CPU / memory / load over the recent window, with a status
 * strip telling apart "running but disconnected" from "not running at all" —
 * what a user needs to explain why a device dropped.
 */
const DeviceHealth = ({ deviceId }: { deviceId: string }) => {
  const { t } = useTranslation('setting');
  const { data } = useClientDataSWR<DeviceMetricSeries>(
    [DEVICE_METRICS_SWR_KEY, deviceId],
    () => deviceService.getMetricSeries(deviceId),
    { refreshInterval: REFRESH_INTERVAL_MS },
  );

  if (!data) return null;

  if (data.points.length === 0) {
    return (
      <Text fontSize={12} type={'secondary'}>
        {t('devices.health.empty')}
      </Text>
    );
  }

  const timeline = buildHealthTimeline(data);
  const rows = (pick: (slot: (typeof timeline.slots)[number]) => number | null) =>
    timeline.slots.map((slot) => ({ time: time(slot.start), value: pick(slot) }));
  const statusLabel: Record<HealthSlotStatus, string> = {
    missing: t('devices.health.status.missing'),
    offline: t('devices.health.status.offline'),
    online: t('devices.health.status.online'),
    pending: t('devices.health.status.pending'),
  };

  return (
    <Flexbox gap={16}>
      <Flexbox gap={6}>
        <Tracker
          blockGap={1}
          blockHeight={16}
          data={timeline.slots.map((slot) => ({
            color: SLOT_COLOR[slot.status],
            key: slot.start,
            tooltip: `${time(slot.start)} · ${statusLabel[slot.status]}`,
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
        {timeline.stretches.length > 0 && (
          <Flexbox gap={2}>
            {timeline.stretches.map((stretch) => (
              <Flexbox horizontal align={'center'} gap={6} key={stretch.start}>
                <span
                  style={{
                    background: SLOT_COLOR[stretch.status],
                    borderRadius: 2,
                    flex: 'none',
                    height: 8,
                    width: 8,
                  }}
                />
                <Text fontSize={12} type={'secondary'}>
                  {time(stretch.start)}–{time(stretch.end)} {statusLabel[stretch.status]}
                </Text>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </Flexbox>

      <MetricChart
        ceiling={100}
        data={rows((slot) => slot.cpuPercent)}
        format={(v) => percent(v)}
        label={t('devices.health.cpu')}
        latest={percent(timeline.latest?.cpuPercent)}
      />
      <MetricChart
        ceiling={100}
        data={rows((slot) => slot.memoryPercent)}
        format={(v) => percent(v)}
        label={t('devices.health.memory')}
        latest={
          data.memoryTotalBytes
            ? `${percent(timeline.latest?.memoryPercent)} · ${formatSize(data.memoryTotalBytes)}`
            : percent(timeline.latest?.memoryPercent)
        }
      />
      {timeline.slots.some((slot) => slot.load1 !== null) && (
        <MetricChart
          ceiling={timeline.loadCeiling}
          data={rows((slot) => slot.load1)}
          format={(v) => v.toFixed(2)}
          label={t('devices.health.load', { count: data.cpuCount ?? 1 })}
          latest={timeline.latest?.load1?.toFixed(2) ?? '—'}
        />
      )}
    </Flexbox>
  );
};

export default DeviceHealth;
