'use client';

import type { DeviceListItem, DeviceWorkspaceShare } from '@lobechat/types';
import {
  ActionIcon,
  confirmModal,
  createStaticStyles,
  cssVar,
  Flexbox,
  Icon,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import dayjs from 'dayjs';
import {
  ActivityIcon,
  BotIcon,
  CableIcon,
  CalendarClockIcon,
  CpuIcon,
  FolderIcon,
  GaugeIcon,
  HardDriveIcon,
  HeartPulseIcon,
  LayersIcon,
  type LucideIcon,
  MemoryStickIcon,
  MonitorIcon,
  PlayIcon,
  PowerIcon,
  ServerCogIcon,
  ServerIcon,
  Share2Icon,
  UserIcon,
  XIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonBar from '@/components/Skeleton/Bar';
import UserAvatar from '@/components/UserAvatar';
import { createWorkspaceLambdaClient } from '@/libs/trpc/client';
import { formatSize } from '@/utils/format';

import Connections from './Connections';
import { refreshDeviceList } from './const';
import { BoundAgentList, RunningTopicList } from './DeviceActivity';
import DeviceHealth, { HealthLegend } from './DeviceHealth';
import { formatPercent, usageLevel } from './DeviceHealth/format';
import { usageTextColor, useDeviceMetricSeries } from './DeviceHealth/shared';
import { UsageBar } from './DeviceHealth/UsageMeter';
import { latestUsageView } from './DeviceHealth/viewState';
import { getDeviceIcon, getPlatformLabel } from './getDeviceIcon';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  cardBody: css`
    padding: 16px;
  `,
  cardHeader: css`
    padding-block: 10px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorFillQuaternary};
  `,
  code: css`
    overflow: hidden;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  // Two info cards side by side, stacking once the column gets narrow. The
  // `min(100%, …)` floor lets a lone column shrink below it on a phone instead
  // of overflowing the padded settings container.
  infoGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: 16px;
  `,
  row: css`
    min-height: 48px;
    padding-block: 10px;
    padding-inline: 16px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  statGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
    gap: 16px;
  `,
  statusPill: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 999px;

    font-size: 13px;
    font-weight: 500;
  `,
}));

interface DetailCardProps {
  children: ReactNode;
  extra?: ReactNode;
  icon: LucideIcon;
  /** Rows draw their own padding; free-form content gets the card's. */
  padded?: boolean;
  title: string;
}

const DetailCard = ({ children, extra, icon, padded = true, title }: DetailCardProps) => (
  <section className={styles.card}>
    <Flexbox
      horizontal
      align={'center'}
      className={styles.cardHeader}
      distribution={'space-between'}
      gap={8}
    >
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon icon={icon} size={14} style={{ color: cssVar.colorTextTertiary }} />
        <Text fontSize={13} weight={500}>
          {title}
        </Text>
      </Flexbox>
      {extra}
    </Flexbox>
    {padded ? <div className={styles.cardBody}>{children}</div> : children}
  </section>
);

const InfoRow = ({
  children,
  icon,
  label,
}: {
  children: ReactNode;
  icon: LucideIcon;
  label: string;
}) => (
  <Flexbox
    horizontal
    align={'center'}
    className={styles.row}
    distribution={'space-between'}
    gap={16}
  >
    <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none' }}>
      <Icon icon={icon} size={14} style={{ color: cssVar.colorTextTertiary }} />
      <Text fontSize={13} type={'secondary'}>
        {label}
      </Text>
    </Flexbox>
    <Flexbox
      horizontal
      align={'center'}
      gap={8}
      justify={'flex-end'}
      style={{ minWidth: 0, textAlign: 'end' }}
    >
      {children}
    </Flexbox>
  </Flexbox>
);

const Empty = () => <Text type={'secondary'}>—</Text>;

interface StatCardProps {
  detail?: string;
  icon: LucideIcon;
  /** First read still in flight: placeholders in the reading's own line boxes. */
  loading?: boolean;
  title: string;
  value: number | null | undefined;
}

/** One reading at a glance: the big share, its absolute size, and the segmented bar. */
const StatCard = ({ detail, icon, loading, title, value }: StatCardProps) => (
  <DetailCard icon={icon} title={title}>
    {loading ? (
      <Flexbox aria-busy gap={14}>
        <Flexbox justify={'center'} style={{ height: 34 }}>
          <SkeletonBar height={24} width={72} />
        </Flexbox>
        <SkeletonBar height={8} />
      </Flexbox>
    ) : (
      <Flexbox gap={14}>
        <Flexbox horizontal align={'baseline'} distribution={'space-between'} gap={8}>
          <Text
            fontSize={28}
            style={{ color: usageTextColor(usageLevel(value)), lineHeight: 1.2 }}
            weight={600}
          >
            {formatPercent(value)}
          </Text>
          {detail && (
            <Text ellipsis fontSize={13} type={'secondary'}>
              {detail}
            </Text>
          )}
        </Flexbox>
        <UsageBar height={8} value={value} />
      </Flexbox>
    )}
  </DetailCard>
);

interface DeviceOverviewProps {
  /** Operating the device (client updates); public workspace devices allow any non-viewer member. */
  canOperate: boolean;
  device: DeviceListItem;
}

/**
 * Overview tab of the device detail page: runtime + spec cards, the current
 * CPU / memory / load readings, the health history, and the live connections.
 */
const DeviceOverview = ({ canOperate, device }: DeviceOverviewProps) => {
  const { t } = useTranslation('setting');
  const { data, error } = useDeviceMetricSeries(device.deviceId, device.scope);
  const usage = latestUsageView({ data, error });
  const latest = usage.loading ? null : usage.latest;

  const channels = device.channels ?? [];
  const online = channels.length > 0;
  // The persisted copy carries no channels: presence is unknown, not offline.
  const presenceUnknown = !!device.onlineUnknown;

  const newest = data?.points.at(-1);
  const cores = data?.cpuCount ?? null;
  const memoryTotal = data?.memoryTotalBytes ?? null;
  const memoryUsed = newest?.memoryUsedBytes ?? null;
  const diskTotal = data?.diskTotalBytes ?? null;
  const diskUsed = newest?.diskUsedBytes ?? null;

  const lastConnected = dayjs(channels[0]?.connectedAt ?? device.lastSeen).fromNow();
  const platformLabel = getPlatformLabel(device.platform);
  const enrollerName =
    device.enroller?.fullName ||
    device.enroller?.username ||
    t('workspaceSetting.devices.unknownEnroller');

  // Revoke one workspace share of a personal device. The share entry's
  // `deviceId` is the workspace-scoped twin, removed via the workspace-scoped
  // mutation under an explicitly pinned workspace client — the personal
  // settings page has no active workspace context to inherit.
  const handleRevokeShare = (share: DeviceWorkspaceShare) =>
    confirmModal({
      content: t('devices.share.revokeConfirmDesc'),
      okButtonProps: { danger: true },
      okText: t('devices.share.revoke'),
      onOk: async () => {
        try {
          await createWorkspaceLambdaClient(share.workspaceId).device.removeWorkspaceDevice.mutate({
            deviceId: share.deviceId,
          });
          refreshDeviceList();
        } catch (error) {
          toast.error((error as Error).message);
          throw error;
        }
      },
      title: t('devices.share.revokeConfirmTitle', {
        name: share.workspaceName ?? share.workspaceId,
      }),
    });

  return (
    <Flexbox gap={16}>
      <div className={styles.infoGrid}>
        <DetailCard icon={ActivityIcon} padded={false} title={t('devices.detail.runtime')}>
          <InfoRow icon={PowerIcon} label={t('devices.detail.status')}>
            <span
              className={styles.statusPill}
              style={{
                background: online ? cssVar.colorSuccessBg : cssVar.colorFillTertiary,
                color: online ? cssVar.colorSuccess : cssVar.colorTextSecondary,
              }}
            >
              <span
                style={{
                  background: online ? cssVar.colorSuccess : cssVar.colorTextQuaternary,
                  borderRadius: '50%',
                  height: 6,
                  width: 6,
                }}
              />
              {presenceUnknown
                ? t('devices.status.checking')
                : online
                  ? t('devices.status.online')
                  : t('devices.status.offline')}
            </span>
          </InfoRow>
          <InfoRow icon={MonitorIcon} label={t('devices.detail.os')}>
            {platformLabel ? (
              <>
                <span style={{ color: cssVar.colorTextSecondary, display: 'flex' }}>
                  {getDeviceIcon(device.platform, 14)}
                </span>
                <Text>{platformLabel}</Text>
              </>
            ) : (
              <Empty />
            )}
          </InfoRow>
          <InfoRow icon={CableIcon} label={t('devices.detail.connections')}>
            {online ? <Text>{channels.length}</Text> : <Empty />}
          </InfoRow>
          <InfoRow icon={CalendarClockIcon} label={t('devices.detail.lastConnected')}>
            <Text>{lastConnected}</Text>
          </InfoRow>
          {device.scope === 'workspace' && device.enroller && (
            <InfoRow icon={UserIcon} label={t('workspaceSetting.devices.enrolledByLabel')}>
              <UserAvatar avatar={device.enroller.avatar} name={enrollerName} size={20} />
              <Text ellipsis>{enrollerName}</Text>
            </InfoRow>
          )}
        </DetailCard>

        <DetailCard icon={ServerCogIcon} padded={false} title={t('devices.detail.specs')}>
          <InfoRow icon={ServerIcon} label={t('devices.card.hostname')}>
            {device.hostname ? (
              <span className={styles.code} title={device.hostname}>
                {device.hostname}
              </span>
            ) : (
              <Empty />
            )}
          </InfoRow>
          <InfoRow icon={LayersIcon} label={t('devices.detail.architecture')}>
            {device.architecture ? <Text>{device.architecture}</Text> : <Empty />}
          </InfoRow>
          <InfoRow icon={CpuIcon} label={t('devices.detail.cpu')}>
            {cores ? <Text>{t('devices.detail.cores', { count: cores })}</Text> : <Empty />}
          </InfoRow>
          <InfoRow icon={MemoryStickIcon} label={t('devices.detail.memory')}>
            {memoryTotal ? <Text>{formatSize(memoryTotal)}</Text> : <Empty />}
          </InfoRow>
          {diskTotal ? (
            <InfoRow icon={HardDriveIcon} label={t('devices.detail.disk')}>
              <Text>{formatSize(diskTotal)}</Text>
            </InfoRow>
          ) : null}
          <InfoRow icon={FolderIcon} label={t('devices.card.workingDir')}>
            {device.defaultCwd ? (
              <span className={styles.code} title={device.defaultCwd}>
                {device.defaultCwd}
              </span>
            ) : (
              <Empty />
            )}
          </InfoRow>
        </DetailCard>
      </div>

      {/* What the machine is doing for agents — the first thing to check
          before restarting, updating or unsharing it. */}
      <div className={styles.infoGrid}>
        <DetailCard
          icon={PlayIcon}
          padded={false}
          title={t('devices.activity.runningTopics.title')}
        >
          <RunningTopicList deviceId={device.deviceId} />
        </DetailCard>
        <DetailCard icon={BotIcon} padded={false} title={t('devices.activity.boundAgents.title')}>
          <BoundAgentList deviceId={device.deviceId} />
        </DetailCard>
      </div>

      <div className={styles.statGrid}>
        <StatCard
          detail={cores ? t('devices.detail.cores', { count: cores }) : undefined}
          icon={CpuIcon}
          loading={usage.loading}
          title={t('devices.card.cpuUsage')}
          value={latest?.cpuPercent}
        />
        <StatCard
          icon={MemoryStickIcon}
          loading={usage.loading}
          title={t('devices.card.memoryUsage')}
          value={latest?.memoryPercent}
          detail={
            memoryUsed !== null && memoryTotal
              ? `${formatSize(memoryUsed)} / ${formatSize(memoryTotal)}`
              : undefined
          }
        />
        <StatCard
          icon={GaugeIcon}
          loading={usage.loading}
          title={t('devices.detail.loadUsage')}
          value={latest?.loadPercent}
          detail={
            newest?.load1 !== null && newest?.load1 !== undefined && cores
              ? `${newest.load1.toFixed(2)} / ${t('devices.detail.cores', { count: cores })}`
              : undefined
          }
        />
        {!usage.loading && usage.reportsDisk && (
          <StatCard
            icon={HardDriveIcon}
            title={t('devices.card.diskUsage')}
            value={latest?.diskPercent}
            detail={
              diskUsed !== null && diskTotal
                ? `${formatSize(diskUsed)} / ${formatSize(diskTotal)}`
                : undefined
            }
          />
        )}
      </div>

      <DetailCard extra={<HealthLegend />} icon={HeartPulseIcon} title={t('devices.health.title')}>
        <DeviceHealth deviceId={device.deviceId} scope={device.scope} />
      </DetailCard>

      <DetailCard icon={CableIcon} title={t('devices.detail.connections')}>
        <Connections canEdit={canOperate} device={device} />
      </DetailCard>

      {device.scope === 'personal' && !!device.sharedWorkspaces?.length && (
        <DetailCard icon={Share2Icon} padded={false} title={t('devices.share.detailLabel')}>
          {device.sharedWorkspaces.map((share) => (
            <Flexbox
              horizontal
              align={'center'}
              className={styles.row}
              gap={8}
              key={share.workspaceId}
            >
              <Text ellipsis style={{ flex: 1, minWidth: 0 }}>
                {share.workspaceName ?? share.workspaceId}
              </Text>
              <Tag size={'small'}>
                {share.visibility === 'private'
                  ? t('devices.share.visibilityTag.private')
                  : t('devices.share.visibilityTag.public')}
              </Tag>
              <ActionIcon
                icon={XIcon}
                size={'small'}
                title={t('devices.share.revoke')}
                onClick={() => handleRevokeShare(share)}
              />
            </Flexbox>
          ))}
        </DetailCard>
      )}
    </Flexbox>
  );
};

export default DeviceOverview;
