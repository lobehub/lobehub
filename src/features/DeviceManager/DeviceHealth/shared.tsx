import type { DeviceMetricSeries } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { deviceService } from '@/services/device';

import type { HealthSlotStatus, HealthStripBlock } from './buildHealthTimeline';
import { formatPercent, peakUsageLevel, type UsageLevel } from './format';

const DEVICE_METRICS_SWR_KEY = 'device/metricSeries';
/** Devices upload every 5 minutes; polling faster only re-reads the same samples. */
const REFRESH_INTERVAL_MS = 5 * 60_000;

/**
 * The device's health series. The list-row preview and the detail panel read
 * the same key, so opening a device reuses the preview's data. `enabled: false`
 * (an off-screen row) stops fetching; cached data comes back when it is on
 * screen again.
 */
export const useDeviceMetricSeries = (deviceId: string, enabled = true) =>
  useClientDataSWR<DeviceMetricSeries>(
    enabled ? [DEVICE_METRICS_SWR_KEY, deviceId] : null,
    () => deviceService.getMetricSeries(deviceId),
    { refreshInterval: REFRESH_INTERVAL_MS },
  );

export const USAGE_COLOR: Record<UsageLevel, string> = {
  critical: cssVar.colorError,
  high: cssVar.colorWarning,
  normal: cssVar.colorSuccess,
};

/**
 * Non-running states stay grey so green / yellow / red keep meaning how loaded
 * a running machine is: a disconnect is a bright grey (the machine was still
 * running), no data a faint one.
 */
const STATUS_COLOR: Record<Exclude<HealthSlotStatus, 'online'>, string> = {
  missing: cssVar.colorFillTertiary,
  offline: cssVar.colorTextQuaternary,
  pending: cssVar.colorFillQuaternary,
};

export const blockColor = (block: HealthStripBlock) =>
  block.status === 'online'
    ? USAGE_COLOR[
        peakUsageLevel(block.peak.cpuPercent, block.peak.memoryPercent, block.peak.loadPercent) ??
          'normal'
      ]
    : STATUS_COLOR[block.status];

/** Text color for a reading — the same green / yellow / red as the strip; no reading keeps the default. */
export const usageTextColor = (level: UsageLevel | undefined) =>
  level ? USAGE_COLOR[level] : undefined;

export const formatClock = (ms: number) => dayjs(ms).format('HH:mm');

export const useStatusLabels = (): Record<HealthSlotStatus, string> => {
  const { t } = useTranslation('setting');
  return {
    missing: t('devices.health.status.missing'),
    offline: t('devices.health.status.offline'),
    online: t('devices.health.status.online'),
    pending: t('devices.health.status.pending'),
  };
};

/** Hover text for one strip block: its time span, state, and peak readings while running. */
export const useBlockTooltip = () => {
  const { t } = useTranslation('setting');
  const statusLabel = useStatusLabels();
  return (block: HealthStripBlock) => {
    const head = `${formatClock(block.start)}–${formatClock(block.end)} · ${statusLabel[block.status]}`;
    if (block.status !== 'online' && block.status !== 'offline') return head;
    return `${head} · ${t('devices.health.cpu')} ${formatPercent(block.peak.cpuPercent)} · ${t(
      'devices.health.memory',
    )} ${formatPercent(block.peak.memoryPercent)} · ${t('devices.health.loadShort')} ${formatPercent(
      block.peak.loadPercent,
    )}`;
  };
};

const LEGEND: { color: string; key: string }[] = [
  { color: USAGE_COLOR.normal, key: 'devices.health.level.normal' },
  { color: USAGE_COLOR.high, key: 'devices.health.level.high' },
  { color: USAGE_COLOR.critical, key: 'devices.health.level.critical' },
  { color: STATUS_COLOR.offline, key: 'devices.health.level.offline' },
  { color: STATUS_COLOR.missing, key: 'devices.health.level.missing' },
];

/** One-line key for the strip colors — replaces the old per-period text list. */
export const HealthLegend = () => {
  const { t } = useTranslation('setting');
  return (
    <Flexbox horizontal align={'center'} gap={8}>
      {LEGEND.map(({ color, key }) => (
        <Flexbox horizontal align={'center'} gap={4} key={key}>
          <span style={{ background: color, borderRadius: 2, height: 8, width: 8 }} />
          <Text fontSize={11} type={'secondary'}>
            {t(key as 'devices.health.level.normal')}
          </Text>
        </Flexbox>
      ))}
    </Flexbox>
  );
};
