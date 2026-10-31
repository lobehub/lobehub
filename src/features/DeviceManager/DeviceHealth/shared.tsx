import type { DeviceScope } from '@lobechat/types';
import { cssVar, Flexbox, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import { deviceSelectors, useDeviceStore } from '@/store/device';

import type { HealthSlotStatus, HealthStripBlock } from './buildHealthTimeline';
import { formatPercent, peakUsageLevel, type UsageLevel } from './format';

/**
 * The device's health series, from the device store's replica. The list-row
 * preview, the hover panel, the composer chip and the detail panel read the
 * same entry, so opening a device reuses the preview's data, and a revisit
 * charts the persisted copy before the server answers. `scope` is the list
 * item's, so a deviceId enrolled both personally and in the workspace reads
 * the row it was listed as. `enabled: false` (an off-screen row) stops
 * fetching; the stored series stays.
 */
export const useDeviceMetricSeries = (
  deviceId: string,
  scope: DeviceScope | undefined,
  enabled = true,
) => {
  const params = { deviceId, scope };
  const { error, isValidating, revalidate } = useDeviceStore((s) => s.useFetchDeviceMetricSeries)(
    params,
    enabled && !!deviceId,
  );
  const data = useDeviceStore(deviceSelectors.getMetricSeries(params));
  return { data, error, isValidating, mutate: revalidate };
};

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
