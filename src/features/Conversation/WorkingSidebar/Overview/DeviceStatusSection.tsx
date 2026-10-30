'use client';

import type { DeviceListItem, DeviceMetricSeries } from '@lobechat/types';
import { Button, createStaticStyles, cssVar, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DeviceRunningSummaryValue } from '@/features/DeviceManager/DeviceActivity/RunningUsers';
import { useDeviceMetricSeries } from '@/features/DeviceManager/DeviceHealth/shared';
import UsageMeter, {
  UsageMeterGroup,
  UsageMeterSkeleton,
} from '@/features/DeviceManager/DeviceHealth/UsageMeter';
import { latestUsageView } from '@/features/DeviceManager/DeviceHealth/viewState';
import { getDeviceIcon, getPlatformLabel } from '@/features/DeviceManager/getDeviceIcon';
import { useDeviceActivityText } from '@/features/DeviceManager/useDeviceActivityText';

import { OverviewRow } from './OverviewRow';
import { sectionStyles } from './sectionStyles';
import { useBoundDevice } from './useBoundDevice';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    padding-block: 4px;
    padding-inline: 8px;
  `,
  code: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  infoGrid: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
  `,
  name: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 600;
    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  presence: css`
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  `,
  sub: css`
    overflow: hidden;

    font-size: 12px;
    line-height: 16px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tile: css`
    display: grid;
    flex-shrink: 0;
    place-items: center;

    width: 32px;
    height: 32px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 9px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

interface DeviceStatusSectionProps {
  /** Polls the device's presence and CPU / memory / disk series only while the Overview is on screen. */
  active: boolean;
  deviceId: string;
}

/**
 * The device the topic runs on, as its device card shows it: presence,
 * hostname, running topics and the latest CPU / memory / disk usage. Answers "is the
 * machine doing this work healthy and busy?" without leaving the conversation.
 */
const DeviceStatusSection = memo<DeviceStatusSectionProps>(({ active, deviceId }) => {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const bound = useBoundDevice(deviceId, active);
  const device = bound.status === 'ready' ? bound.device : undefined;
  const { data, error } = useDeviceMetricSeries(deviceId, device?.scope, active && !!device);

  if (bound.status === 'loading')
    return (
      <Flexbox className={sectionStyles.section}>
        <div className={sectionStyles.skeleton}>
          <Skeleton.Text rows={2} />
        </div>
      </Flexbox>
    );

  // A failed read is not a removed device: say so and offer a retry.
  if (bound.status === 'error')
    return (
      <Flexbox className={sectionStyles.section}>
        <OverviewRow
          danger
          icon={TriangleAlertIcon}
          iconColor={cssVar.colorError}
          value={t('workingPanel.overview.deviceError')}
          trailing={
            <Button
              icon={<Icon icon={RefreshCwIcon} size={12} />}
              size={'small'}
              onClick={bound.retry}
            >
              {tCommon('retry')}
            </Button>
          }
        />
      </Flexbox>
    );

  // Removed, or not visible in this workspace: nothing to describe.
  if (!device) return null;

  return <DeviceStatusContent data={data} device={device} error={error} />;
});

DeviceStatusSection.displayName = 'OverviewDeviceStatusSection';

interface DeviceStatusContentProps {
  data?: DeviceMetricSeries;
  device: DeviceListItem;
  error?: unknown;
}

const DeviceStatusContent = ({ data, device, error }: DeviceStatusContentProps) => {
  const { t } = useTranslation('setting');
  const activityText = useDeviceActivityText(device);
  const online = (device.channels ?? []).length > 0;
  const usage = latestUsageView({ data, error });
  const platformLabel = getPlatformLabel(device.platform, device.architecture, device.metadata);
  const displayName = device.friendlyName || device.hostname || device.deviceId;

  return (
    <Flexbox className={sectionStyles.section} data-testid={'overview-device-status'}>
      <Flexbox className={styles.body} gap={14}>
        <Flexbox horizontal align={'center'} gap={10}>
          <span className={styles.tile}>{getDeviceIcon(device.platform, 16)}</span>
          <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
            <span className={styles.name} title={displayName}>
              {displayName}
            </span>
            <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
              <span
                aria-hidden
                className={styles.presence}
                style={{ background: online ? cssVar.colorSuccess : cssVar.colorTextQuaternary }}
              />
              <span className={styles.sub} title={activityText}>
                {platformLabel ? `${activityText} · ${platformLabel}` : activityText}
              </span>
            </Flexbox>
          </Flexbox>
        </Flexbox>

        <div className={styles.infoGrid}>
          <Flexbox gap={2} style={{ minWidth: 0 }}>
            <Text fontSize={12} type={'secondary'}>
              {t('devices.card.hostname')}
            </Text>
            <span className={styles.code} title={device.hostname ?? undefined}>
              {device.hostname || '—'}
            </span>
          </Flexbox>
          <Flexbox gap={2} style={{ minWidth: 0 }}>
            <Text fontSize={12} type={'secondary'}>
              {t('devices.card.runningTopics')}
            </Text>
            <DeviceRunningSummaryValue deviceId={device.deviceId} />
          </Flexbox>
        </div>

        {usage.loading ? (
          <UsageMeterGroup loading>
            <UsageMeterSkeleton />
            <UsageMeterSkeleton />
          </UsageMeterGroup>
        ) : (
          <UsageMeterGroup>
            <UsageMeter label={t('devices.card.cpuUsage')} value={usage.latest?.cpuPercent} />
            <UsageMeter label={t('devices.card.memoryUsage')} value={usage.latest?.memoryPercent} />
            {usage.reportsDisk && (
              <UsageMeter label={t('devices.card.diskUsage')} value={usage.latest?.diskPercent} />
            )}
          </UsageMeterGroup>
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default DeviceStatusSection;
