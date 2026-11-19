'use client';

import type { DeviceListItem, DeviceMetricSeries } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { DeviceRunningSummaryValue } from '@/features/DeviceManager/DeviceActivity/RunningUsers';
import { useDeviceMetricSeries } from '@/features/DeviceManager/DeviceHealth/shared';
import UsageMeter, {
  UsageMeterGroup,
  UsageMeterSkeleton,
} from '@/features/DeviceManager/DeviceHealth/UsageMeter';
import { latestUsageView } from '@/features/DeviceManager/DeviceHealth/viewState';
import { getDeviceIcon, getPlatformLabel } from '@/features/DeviceManager/getDeviceIcon';
import { useDeviceActivityText } from '@/features/DeviceManager/useDeviceActivityText';
import { useDensityTokens } from '@/styles/density';
import { sidebarRow } from '@/styles/density.stylex';

import { SidebarRowSkeleton } from '../DeferredSkeleton';
import { sectionProps } from './sectionStyles';
import { useBoundDevice } from './useBoundDevice';

const styles = stylex.create({
  body: { paddingBlock: '4px', paddingInline: '6px' },
  code: {
    overflow: 'hidden',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  infoGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '12px' },
  name: {
    overflow: 'hidden',
    fontSize: sidebarRow.textFontSize,
    fontWeight: 600,
    lineHeight: sidebarRow.textLineHeight,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  presence: { flex: 'none', width: '6px', height: '6px', borderRadius: '50%' },
  sub: {
    overflow: 'hidden',
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tile: {
    display: 'grid',
    flexShrink: 0,
    placeItems: 'center',
    width: '28px',
    height: '28px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '8px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

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
  const bound = useBoundDevice(deviceId, active);
  const device = bound.status === 'ready' ? bound.device : undefined;
  const { data, error } = useDeviceMetricSeries(deviceId, device?.scope, active && !!device);

  if (bound.status === 'loading')
    return (
      <Flexbox {...sectionProps()}>
        <SidebarRowSkeleton rows={2} />
      </Flexbox>
    );

  // A failed read is not a removed device: say so and offer a retry.
  if (bound.status === 'error')
    return (
      <Flexbox {...sectionProps()}>
        <AsyncError
          align={'start'}
          title={t('workingPanel.overview.deviceError')}
          variant={'inline'}
          onRetry={bound.retry}
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
  const { gap } = useDensityTokens();
  const online = (device.channels ?? []).length > 0;
  const usage = latestUsageView({ data, error });
  const platformLabel = getPlatformLabel(device.platform, device.architecture);
  const displayName = device.friendlyName || device.hostname || device.deviceId;

  return (
    <Flexbox {...sectionProps()} data-testid={'overview-device-status'}>
      <Flexbox className={stylex.props(styles.body).className} gap={12}>
        <Flexbox horizontal align={'center'} gap={gap}>
          <span {...stylex.props(styles.tile)}>{getDeviceIcon(device.platform, 16)}</span>
          <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
            <span {...stylex.props(styles.name)} title={displayName}>
              {displayName}
            </span>
            <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
              <span
                aria-hidden
                className={stylex.props(styles.presence).className}
                style={{ background: online ? cssVar.colorSuccess : cssVar.colorTextQuaternary }}
              />
              <span {...stylex.props(styles.sub)} title={activityText}>
                {platformLabel ? `${activityText} · ${platformLabel}` : activityText}
              </span>
            </Flexbox>
          </Flexbox>
        </Flexbox>

        <div {...stylex.props(styles.infoGrid)}>
          <Flexbox gap={2} style={{ minWidth: 0 }}>
            <Text fontSize={12} type={'secondary'}>
              {t('devices.card.hostname')}
            </Text>
            <span {...stylex.props(styles.code)} title={device.hostname ?? undefined}>
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
