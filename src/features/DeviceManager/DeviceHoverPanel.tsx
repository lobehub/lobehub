'use client';

import type { DeviceListItem } from '@lobechat/types';
import { createStaticStyles, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import {
  CableIcon,
  CalendarClockIcon,
  CpuIcon,
  FolderIcon,
  LayersIcon,
  type LucideIcon,
  MemoryStickIcon,
  MonitorIcon,
  PlayIcon,
  PowerIcon,
  ServerIcon,
  UserIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import { DeviceRunningSummaryValue } from './DeviceActivity/RunningUsers';
import { useDeviceMetricSeries } from './DeviceHealth/shared';
import UsageMeter, { UsageMeterGroup, UsageMeterSkeleton } from './DeviceHealth/UsageMeter';
import { latestUsageView } from './DeviceHealth/viewState';
import { buildDeviceHoverSummary } from './deviceHoverSummary';
import { getDeviceIcon } from './getDeviceIcon';

const styles = createStaticStyles(({ css }) => ({
  code: css`
    overflow: hidden;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  container: css`
    width: 300px;
    padding-block: 4px 8px;
  `,
  row: css`
    padding-block: 4px;
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  sectionBar: css`
    flex-shrink: 0;
    width: 3px;
    height: 14px;
    border-radius: 2px;
  `,
  sectionTitle: css`
    padding-block: 6px;
    padding-inline: 8px;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  usage: css`
    padding-block: 4px;
    padding-inline: 8px;
  `,
  value: css`
    overflow: hidden;
    min-width: 0;
    color: ${cssVar.colorText};
    text-align: end;
  `,
}));

const Section = ({ color, title }: { color: string; title: string }) => (
  <Flexbox horizontal align={'center'} className={styles.sectionTitle} gap={8}>
    <div className={styles.sectionBar} style={{ background: color }} />
    <span>{title}</span>
  </Flexbox>
);

const InfoRow = ({
  children,
  icon,
  label,
}: {
  children?: ReactNode;
  icon: LucideIcon;
  label: string;
}) => (
  <Flexbox horizontal align={'center'} className={styles.row} gap={16} justify={'space-between'}>
    <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none' }}>
      <Icon icon={icon} size={13} />
      <span>{label}</span>
    </Flexbox>
    <Flexbox horizontal align={'center'} className={styles.value} gap={6} justify={'flex-end'}>
      {children ?? <Text type={'secondary'}>—</Text>}
    </Flexbox>
  </Flexbox>
);

interface DeviceHoverPanelProps {
  device: DeviceListItem;
}

/**
 * A device's details at a glance, shown beside its row in the execution
 * environment picker: live state and load first (what decides whether to run
 * there), then the machine's specs. A read-only digest of the detail page's
 * overview, reading the same metric series so opening one warms the other.
 */
const DeviceHoverPanel = ({ device }: DeviceHoverPanelProps) => {
  const { t } = useTranslation('setting');

  // The series also carries the specs (cores, memory), so fetch it for offline
  // devices too; only an online device's last reading is shown as its load.
  const { data, error } = useDeviceMetricSeries(device.deviceId, device.scope);
  const usage = latestUsageView({ data, error });
  const summary = buildDeviceHoverSummary(device, data);
  const { online } = summary;

  return (
    <Flexbox className={styles.container}>
      <Section color={cssVar.colorSuccess} title={t('devices.detail.runtime')} />
      <InfoRow icon={PowerIcon} label={t('devices.detail.status')}>
        <span
          style={{
            background: online ? cssVar.colorSuccess : cssVar.colorTextQuaternary,
            borderRadius: '50%',
            flex: 'none',
            height: 6,
            width: 6,
          }}
        />
        <span>
          {summary.onlineUnknown
            ? t('devices.status.checking')
            : online
              ? t('devices.status.online')
              : t('devices.status.offline')}
        </span>
      </InfoRow>
      {online && (
        <InfoRow icon={CableIcon} label={t('devices.detail.connections')}>
          {summary.connections}
        </InfoRow>
      )}
      <InfoRow icon={CalendarClockIcon} label={t('devices.detail.lastConnected')}>
        {dayjs(summary.lastConnectedAt).fromNow()}
      </InfoRow>
      {online && (
        <div className={styles.usage}>
          {usage.loading ? (
            <UsageMeterGroup loading>
              <UsageMeterSkeleton />
              <UsageMeterSkeleton />
            </UsageMeterGroup>
          ) : (
            <UsageMeterGroup>
              <UsageMeter label={t('devices.card.cpuUsage')} value={usage.latest?.cpuPercent} />
              <UsageMeter
                label={t('devices.card.memoryUsage')}
                value={usage.latest?.memoryPercent}
              />
            </UsageMeterGroup>
          )}
        </div>
      )}
      {online && (
        <InfoRow icon={PlayIcon} label={t('devices.card.runningTopics')}>
          <DeviceRunningSummaryValue deviceId={device.deviceId} />
        </InfoRow>
      )}

      <Section color={cssVar.colorInfo} title={t('devices.detail.specs')} />
      <InfoRow icon={MonitorIcon} label={t('devices.detail.os')}>
        {summary.platformLabel ? (
          <>
            <span style={{ display: 'flex', flex: 'none' }}>
              {getDeviceIcon(device.platform, 13)}
            </span>
            <span>{summary.platformLabel}</span>
          </>
        ) : undefined}
      </InfoRow>
      <InfoRow icon={LayersIcon} label={t('devices.detail.architecture')}>
        {summary.architecture}
      </InfoRow>
      <InfoRow icon={CpuIcon} label={t('devices.detail.cpu')}>
        {summary.cores ? t('devices.detail.cores', { count: summary.cores }) : undefined}
      </InfoRow>
      <InfoRow icon={MemoryStickIcon} label={t('devices.detail.memory')}>
        {summary.memoryTotalBytes ? formatSize(summary.memoryTotalBytes) : undefined}
      </InfoRow>
      <InfoRow icon={ServerIcon} label={t('devices.card.hostname')}>
        {summary.hostname ? (
          <span className={styles.code} title={summary.hostname}>
            {summary.hostname}
          </span>
        ) : undefined}
      </InfoRow>
      <InfoRow icon={FolderIcon} label={t('devices.card.workingDir')}>
        {summary.workingDir ? (
          <span className={styles.code} title={summary.workingDir}>
            {summary.workingDir}
          </span>
        ) : undefined}
      </InfoRow>
      {summary.enrollerName !== undefined && (
        <InfoRow icon={UserIcon} label={t('workspaceSetting.devices.enrolledByLabel')}>
          <Text ellipsis fontSize={12}>
            {summary.enrollerName ?? t('workspaceSetting.devices.unknownEnroller')}
          </Text>
        </InfoRow>
      )}
    </Flexbox>
  );
};

export default DeviceHoverPanel;
