'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Avatar, DropdownMenu, Flexbox, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import {
  EyeOffIcon,
  FolderIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  Share2Icon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { refreshDeviceList } from './const';
import { getDeviceIcon } from './getDeviceIcon';
import { openShareDeviceModal } from './ShareDeviceModal';
import { useCanEditDevice } from './useCanEditDevice';

const styles = createStaticStyles(({ css }) => ({
  // Code-font cwd line; truncates rather than wrapping so a deep path keeps the
  // row at one line.
  cwd: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  // Same tile treatment as the credential list rows (creds/features/style.ts).
  iconTile: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;
    border-radius: 12px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  row: css`
    cursor: pointer;

    padding-block: 12px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    transition: background 0.15s ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -1px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  rowActive: css`
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  statusOffline: css`
    width: 8px;
    height: 8px;
    border: 1.5px solid ${cssVar.colorTextQuaternary};
    border-radius: 50%;
  `,
  statusOnline: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};
    box-shadow: 0 0 0 3px ${cssVar.colorSuccessBg};
  `,
}));

interface DeviceItemProps {
  device: DeviceListItem;
  isCurrent?: boolean;
  onSelect: () => void;
  selected?: boolean;
}

const DeviceItem = memo<DeviceItemProps>(({ device, isCurrent, onSelect, selected }) => {
  const { t } = useTranslation('setting');
  const { t: tCommon } = useTranslation('common');
  const canEdit = useCanEditDevice()(device);
  const currentUserId = useUserStore(userProfileSelectors.userId);

  // Workspace devices are self-or-owner-gated + workspace-scoped on the
  // server; personal devices stay userId-scoped. Route by the device's own
  // scope.
  const onRemoveSuccess = () => refreshDeviceList();
  const removePersonal = lambdaQuery.device.removeDevice.useMutation({
    onSuccess: onRemoveSuccess,
  });
  const removeWorkspace = lambdaQuery.device.removeWorkspaceDevice.useMutation({
    onSuccess: onRemoveSuccess,
  });
  const removeDevice = device.scope === 'workspace' ? removeWorkspace : removePersonal;

  const displayName = device.friendlyName || device.hostname || device.deviceId;
  const isFallback = device.identitySource === 'fallback';
  // Online when the device has at least one live connection in `device.channels`.
  const channels = device.channels ?? [];
  const online = channels.length > 0;
  const statusTooltip = online
    ? t('devices.channel.connected', {
        time: dayjs(channels[0]?.connectedAt ?? device.lastSeen).fromNow(),
      })
    : t('devices.lastSeen', { time: dayjs(device.lastSeen).fromNow() });

  // Publish / make-private for workspace enrollments (LOBE-11690). Reuses the
  // shared visibility-confirm body so the consequences copy matches agents /
  // files. Success feedback is the row itself moving to the other tab after
  // the list refresh.
  const setVisibility = lambdaQuery.device.setWorkspaceDeviceVisibility.useMutation({
    onSuccess: () => refreshDeviceList(),
  });

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
  // (LOBE-11760): an owner demoting another member's public device would
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

  // Share-to-workspace entry for personal enrollments (LOBE-11699). The share
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

  return (
    <Flexbox
      horizontal
      align={'center'}
      aria-pressed={selected}
      className={cx(styles.row, selected && styles.rowActive)}
      gap={16}
      role={'button'}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        // Mirror native button keyboard semantics for the div-as-button row.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className={styles.iconTile}>{getDeviceIcon(device.platform, 20)}</div>

      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Text ellipsis fontSize={15} weight={500}>
            {displayName}
          </Text>
          <Tooltip title={statusTooltip}>
            <span className={online ? styles.statusOnline : styles.statusOffline} />
          </Tooltip>
          {isCurrent && <Tag>{t('devices.currentBadge')}</Tag>}
          {device.scope === 'workspace' && device.sharedFromPersonal && (
            // Member-shared machine (vs directly enrolled infra) — mirrors the
            // "Shared by {name}" tag on workspace connectors/credentials.
            <Tag>
              {t('devices.share.sharedByTag', {
                name:
                  device.enroller?.fullName ||
                  device.enroller?.username ||
                  t('workspaceSetting.devices.unknownEnroller'),
              })}
            </Tag>
          )}
          {device.scope === 'personal' && !!device.sharedWorkspaces?.length && (
            // At-a-glance "this machine also lives in N workspaces" marker;
            // the per-workspace list (and revoke) sits in the detail panel.
            <Tag>{t('devices.share.badge', { count: device.sharedWorkspaces.length })}</Tag>
          )}
          {isFallback && (
            <Tooltip title={t('devices.fallbackTooltip')}>
              <Tag icon={<Icon icon={TriangleAlertIcon} />}>{t('devices.fallbackBadge')}</Tag>
            </Tooltip>
          )}
        </Flexbox>
        {device.defaultCwd && (
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <Icon icon={FolderIcon} size={12} style={{ color: cssVar.colorTextQuaternary }} />
            <Text className={styles.cwd} type={'secondary'}>
              {device.defaultCwd}
            </Text>
          </Flexbox>
        )}
      </Flexbox>

      <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none' }}>
        {device.scope === 'workspace' && device.enroller && (
          // Enroller avatar — the at-a-glance "who put this here" answer for
          // shared workspace pools. Hidden in personal scope (always the
          // caller) and for ghost rows (no row yet).
          <Tooltip
            title={t('workspaceSetting.devices.enrolledBy', {
              name:
                device.enroller.fullName ||
                device.enroller.username ||
                t('workspaceSetting.devices.unknownEnroller'),
            })}
          >
            <span onClick={(e) => e.stopPropagation()}>
              <Avatar avatar={device.enroller.avatar ?? undefined} size={20} />
            </span>
          </Tooltip>
        )}
        {canEdit && (
          <span onClick={(e) => e.stopPropagation()}>
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
              <Button icon={MoreHorizontalIcon} />
            </DropdownMenu>
          </span>
        )}
      </Flexbox>
    </Flexbox>
  );
});

DeviceItem.displayName = 'DeviceItem';

export default DeviceItem;
