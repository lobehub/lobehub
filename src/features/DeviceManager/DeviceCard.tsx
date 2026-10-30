'use client';

import type { DeviceListItem } from '@lobechat/types';
import {
  ActionIcon,
  confirmModal,
  DropdownMenu,
  Flexbox,
  Icon,
  Tag,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useInViewport } from 'ahooks';
import {
  EyeOffIcon,
  GlobeIcon,
  MoreVerticalIcon,
  Share2Icon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/components/UserAvatar';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { DeviceRunningSummaryValue } from './DeviceActivity/RunningUsers';
import { useDeviceMetricSeries } from './DeviceHealth/shared';
import UsageMeter, { UsageMeterGroup, UsageMeterSkeleton } from './DeviceHealth/UsageMeter';
import { latestUsageView } from './DeviceHealth/viewState';
import { getDeviceIcon, getPlatformLabel } from './getDeviceIcon';
import { openShareDeviceModal } from './ShareDeviceModal';
import { useCanEditDevice } from './useCanEditDevice';
import { useDeviceActivityText } from './useDeviceActivityText';
import { useDeviceCardMutations } from './useDeviceCardMutations';

const styles = stylex.create({
  body: { paddingBlockStart: '20px', paddingBlockEnd: '16px', paddingInline: '20px' },
  card: {
    cursor: 'pointer',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minWidth: '0',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    transition: {
      'default': 'border-color 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '1px' },
  },
  code: {
    overflow: 'hidden',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '13px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  footer: {
    marginBlockStart: 'auto',
    paddingBlock: '12px',
    paddingInline: '20px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  iconTile: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  infoGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '16px' },
  presence: { flex: 'none', width: '8px', height: '8px', borderRadius: '50%' },
});

interface DeviceCardProps {
  device: DeviceListItem;
  isCurrent?: boolean;
  /** Open this device's detail page. */
  onOpen: () => void;
}

const DeviceCard = memo<DeviceCardProps>(({ device, isCurrent, onOpen }) => {
  // Cards are not virtualized; only cards on screen keep their usage meters polling.
  const cardRef = useRef<HTMLDivElement>(null);
  const [inViewport] = useInViewport(cardRef);
  const { data, error } = useDeviceMetricSeries(device.deviceId, device.scope, !!inViewport);
  const { t } = useTranslation('setting');
  const { t: tCommon } = useTranslation('common');
  const canEdit = useCanEditDevice()(device);
  const currentUserId = useUserStore(userProfileSelectors.userId);

  const { removeDevice, setVisibility } = useDeviceCardMutations(device.scope);

  const displayName = device.friendlyName || device.hostname || device.deviceId;
  const isFallback = device.identitySource === 'fallback';
  // Online when the device has at least one live connection in `device.channels`.
  const channels = device.channels ?? [];
  const online = channels.length > 0;
  // Rendered inline (not as a dot tooltip): "when was this machine last
  // reachable" is the answer needed to pick between rows, and hover can't
  // answer it for a whole list at once — nor at all on touch.
  const activityText = useDeviceActivityText(device);

  // Publish / make-private for workspace enrollments. Reuses the
  // shared visibility-confirm body so the consequences copy matches agents /
  // files.

  const handlePublish = () =>
    confirmModal({
      content: <VisibilityConfirmContent variant={'publish'} />,
      okText: t('devices.visibility.publish'),
      onOk: async () => {
        await setVisibility.mutateAsync({ deviceId: device.deviceId, visibility: 'public' });
      },
      title: t('devices.visibility.publishConfirmTitle'),
    });

  const handleMakePrivate = () =>
    confirmModal({
      content: <VisibilityConfirmContent variant={'makePrivate'} />,
      okButtonProps: { danger: true },
      okText: tCommon('makePrivate.confirm.ok'),
      onOk: async () => {
        await setVisibility.mutateAsync({ deviceId: device.deviceId, visibility: 'private' });
      },
      title: tCommon('makePrivate.confirm.title'),
    });

  // Only persisted workspace rows carry a visibility to toggle — ghosts
  // (unregistered) and personal devices don't. The toggle is enroller-only
  //: an owner demoting another member's public device would
  // move it into that member's private list, appropriating their data. The
  // server rejects non-enroller writes as the backstop.
  const isEnroller = !!currentUserId && device.enroller?.userId === currentUserId;
  const visibilityItems =
    device.scope === 'workspace' && device.registered && isEnroller
      ? device.visibility === 'private'
        ? [
            {
              icon: <Icon icon={GlobeIcon} />,
              key: 'publish',
              label: t('devices.visibility.publish'),
              onClick: handlePublish,
            },
          ]
        : [
            {
              icon: <Icon icon={EyeOffIcon} />,
              key: 'makePrivate',
              label: tCommon('makePrivate'),
              onClick: handleMakePrivate,
            },
          ]
      : [];

  // Share-to-workspace entry for personal enrollments. The share
  // handshake needs a live connection to mint the workspace identity, so the
  // item stays disabled (with an explanatory desc) while the device is offline.
  const shareItems =
    device.scope === 'personal' && device.registered
      ? [
          {
            desc: online ? undefined : t('devices.share.offlineDesc'),
            disabled: !online,
            icon: <Icon icon={Share2Icon} />,
            key: 'share',
            label: t('devices.share.menu'),
            onClick: () => openShareDeviceModal(device),
          },
        ]
      : [];

  const handleRemove = () =>
    confirmModal({
      content: isCurrent
        ? `${t('devices.remove.confirmDesc')}\n\n${t('devices.remove.currentSessionWarning')}`
        : t('devices.remove.confirmDesc'),
      okButtonProps: { danger: true },
      okText: t('devices.actions.remove'),
      onOk: async () => {
        await removeDevice.mutateAsync({ deviceId: device.deviceId });
      },
      title: t('devices.remove.confirm'),
    });

  const enrollerName =
    device.enroller?.fullName ||
    device.enroller?.username ||
    t('workspaceSetting.devices.unknownEnroller');
  const platformLabel = getPlatformLabel(device.platform, device.architecture);
  const usage = latestUsageView({ data, error });

  return (
    <div
      {...stylex.props(styles.card)}
      ref={cardRef}
      role={'link'}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Native link keyboard semantics for the div-as-link card. Only the
        // card itself — keys inside the action menu stay with the menu.
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <Flexbox className={stylex.props(styles.body).className} gap={20}>
        <Flexbox horizontal align={'flex-start'} gap={16}>
          <div {...stylex.props(styles.iconTile)}>{getDeviceIcon(device.platform, 22)}</div>

          <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
            <Text ellipsis fontSize={16} weight={600}>
              {displayName}
            </Text>
            <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
              {platformLabel && (
                <Text fontSize={13} type={'secondary'}>
                  {platformLabel}
                </Text>
              )}
              {isCurrent && <Tag size={'small'}>{t('devices.currentBadge')}</Tag>}
              {device.scope === 'workspace' && device.sharedFromPersonal && (
                // Member-shared machine (vs directly enrolled infra) — mirrors the
                // "Shared by {name}" tag on workspace connectors/credentials.
                <Tag size={'small'}>{t('devices.share.sharedByTag', { name: enrollerName })}</Tag>
              )}
              {device.scope === 'personal' && !!device.sharedWorkspaces?.length && (
                // At-a-glance "this machine also lives in N workspaces" marker;
                // the per-workspace list (and revoke) sits on the detail page.
                <Tag size={'small'}>
                  {t('devices.share.badge', { count: device.sharedWorkspaces.length })}
                </Tag>
              )}
              {isFallback && (
                <Tooltip title={t('devices.fallbackTooltip')}>
                  <Tag icon={<Icon icon={TriangleAlertIcon} />} size={'small'}>
                    {t('devices.fallbackBadge')}
                  </Tag>
                </Tooltip>
              )}
            </Flexbox>
          </Flexbox>

          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            style={{ flex: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {device.scope === 'workspace' && device.enroller && (
              // Enroller avatar — the at-a-glance "who put this here" answer for
              // shared workspace pools. Hidden in personal scope (always the
              // caller) and for ghost rows (no row yet).
              <Tooltip title={t('workspaceSetting.devices.enrolledBy', { name: enrollerName })}>
                <UserAvatar avatar={device.enroller.avatar} name={enrollerName} size={20} />
              </Tooltip>
            )}
            {canEdit && (
              <DropdownMenu
                placement={'bottomRight'}
                items={[
                  ...visibilityItems,
                  ...shareItems,
                  {
                    danger: true,
                    icon: <Icon icon={Trash2Icon} />,
                    key: 'remove',
                    label: t('devices.actions.remove'),
                    onClick: handleRemove,
                  },
                ]}
              >
                <ActionIcon icon={MoreVerticalIcon} size={'small'} title={tCommon('more')} />
              </DropdownMenu>
            )}
          </Flexbox>
        </Flexbox>

        <div {...stylex.props(styles.infoGrid)}>
          <Flexbox gap={4} style={{ minWidth: 0 }}>
            <Text fontSize={13} type={'secondary'}>
              {t('devices.card.hostname')}
            </Text>
            <span {...stylex.props(styles.code)} title={device.hostname ?? undefined}>
              {device.hostname || '—'}
            </span>
          </Flexbox>
          <Flexbox gap={4} style={{ minWidth: 0 }}>
            <Text fontSize={13} type={'secondary'}>
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

      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.footer).className}
        gap={8}
      >
        <span
          aria-hidden
          className={stylex.props(styles.presence).className}
          style={{ background: online ? cssVar.colorSuccess : cssVar.colorTextQuaternary }}
        />
        <Text ellipsis fontSize={13} style={{ minWidth: 0 }} type={'secondary'}>
          {activityText}
        </Text>
      </Flexbox>
    </div>
  );
});

DeviceCard.displayName = 'DeviceCard';

export default DeviceCard;
