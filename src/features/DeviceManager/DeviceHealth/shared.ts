import type { DeviceMetricSeries } from '@lobechat/types';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { deviceService } from '@/services/device';

import type { HealthSlotStatus } from './buildHealthTimeline';

const DEVICE_METRICS_SWR_KEY = 'device/metricSeries';
const REFRESH_INTERVAL_MS = 60_000;

/**
 * The device's health series. The list-row preview and the detail panel read
 * the same key, so opening a device reuses the preview's data.
 */
export const useDeviceMetricSeries = (deviceId: string) =>
  useClientDataSWR<DeviceMetricSeries>(
    [DEVICE_METRICS_SWR_KEY, deviceId],
    () => deviceService.getMetricSeries(deviceId),
    { refreshInterval: REFRESH_INTERVAL_MS },
  );

export const SLOT_COLOR: Record<HealthSlotStatus, string> = {
  missing: cssVar.colorFillSecondary,
  offline: cssVar.colorWarning,
  online: cssVar.colorSuccess,
  pending: cssVar.colorFillQuaternary,
};

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
