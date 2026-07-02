'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceScope } from '@lobechat/types';
import { Button, Checkbox, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ChevronRightIcon,
  FolderCogIcon,
  type LucideIcon,
  MonitorDownIcon,
  ServerIcon,
  TerminalIcon,
  Trash2Icon,
  ZapIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaQuery } from '@/libs/trpc/client';
import { deviceService } from '@/services/device';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { DEVICE_LIST_SWR_KEY, refreshDeviceList } from './const';
import DeviceDetailPanel from './DeviceDetailPanel';
import DeviceItem from './DeviceItem';
import { useCanEditDevice } from './useCanEditDevice';

const styles = createStaticStyles(({ css }) => ({
  // ─── Onboarding empty state ───
  badge: css`
    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  capabilityCard: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  capabilityIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  emptyCard: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  emptyHero: css`
    padding-block: 40px;
    padding-inline: 32px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    text-align: center;

    background: ${cssVar.colorFillQuaternary};
  `,
  heroIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 56px;
    height: 56px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillSecondary};
  `,
  option: css`
    cursor: pointer;
    padding: 20px;
    background: ${cssVar.colorBgContainer};
    transition: background 0.15s ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  optionGrid: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  optionIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  // ─── Master-detail surfaces ───
  detailCol: css`
    align-self: stretch;

    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  listCol: css`
    overflow: hidden;

    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  listHeader: css`
    min-height: 44px;
    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  listScroll: css`
    overflow-y: auto;

    /* Cap the list so long fleets (servers / CLI agents) stay scrollable instead
       of pushing the page — pairs with the detail panel sitting beside it. */
    max-height: 480px;
  `,
  selectAll: css`
    cursor: pointer;
    user-select: none;
  `,
}));

interface ConnectOptionProps {
  badge?: string;
  desc: string;
  icon: LucideIcon;
  onClick: () => void;
  title: string;
}

const ConnectOption = memo<ConnectOptionProps>(({ icon, title, desc, badge, onClick }) => (
  <Flexbox
    horizontal
    align={'flex-start'}
    className={styles.option}
    gap={16}
    role={'button'}
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    }}
  >
    <span className={styles.optionIcon}>
      <Icon icon={icon} size={20} />
    </span>
    <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Text weight={500}>{title}</Text>
        {badge && <span className={styles.badge}>{badge}</span>}
      </Flexbox>
      <Text color={cssVar.colorTextTertiary} fontSize={12}>
        {desc}
      </Text>
    </Flexbox>
    <Icon icon={ChevronRightIcon} size={16} style={{ color: cssVar.colorTextQuaternary }} />
  </Flexbox>
));

const Capabilities = memo(() => {
  const { t } = useTranslation('setting');
  const items: { desc: string; icon: LucideIcon; title: string }[] = [
    {
      desc: t('devices.capabilities.files.desc'),
      icon: FolderCogIcon,
      title: t('devices.capabilities.files.title'),
    },
    {
      desc: t('devices.capabilities.commands.desc'),
      icon: TerminalIcon,
      title: t('devices.capabilities.commands.title'),
    },
    {
      desc: t('devices.capabilities.tools.desc'),
      icon: ZapIcon,
      title: t('devices.capabilities.tools.title'),
    },
  ];
  return (
    <Flexbox gap={16}>
      <Text fontSize={12} type={'secondary'} weight={500}>
        {t('devices.capabilities.title')}
      </Text>
      <Flexbox horizontal gap={16}>
        {items.map((cap) => (
          <Flexbox className={styles.capabilityCard} flex={1} gap={12} key={cap.title}>
            <span className={styles.capabilityIcon}>
              <Icon icon={cap.icon} size={18} />
            </span>
            <Flexbox gap={4}>
              <Text weight={500}>{cap.title}</Text>
              <Text color={cssVar.colorTextTertiary} fontSize={12}>
                {cap.desc}
              </Text>
            </Flexbox>
          </Flexbox>
        ))}
      </Flexbox>
    </Flexbox>
  );
});

// Loading placeholder that reuses the list-card chrome and only skeletonises the
// row text — loading → loaded is a content swap, not a relayout (ux §4.1).
const ListSkeleton = memo(() => (
  <Flexbox className={styles.listCol} flex={1}>
    <Flexbox horizontal align={'center'} className={styles.listHeader}>
      <Skeleton.Button active size={'small'} style={{ height: 16, minWidth: 80, width: 80 }} />
    </Flexbox>
    <Flexbox gap={2} padding={4}>
      {[0, 1, 2, 3].map((i) => (
        <Flexbox horizontal align={'center'} gap={12} key={i} style={{ padding: 12 }}>
          <Skeleton.Avatar active shape={'square'} size={36} />
          <Flexbox flex={1} gap={8}>
            <Skeleton.Button active size={'small'} style={{ height: 14, width: 140 }} />
            <Skeleton.Button active size={'small'} style={{ height: 12, width: 200 }} />
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
  </Flexbox>
));

interface DeviceManagerProps {
  /** Open the enrollment wizard (the modal is owned by the route, by the header button). */
  onConnect: (tab?: 'cli' | 'desktop') => void;
  /** Which device pool this surface manages. */
  scope: DeviceScope;
}

/**
 * Master-detail device manager shared by the personal (`/settings/devices`) and
 * workspace (`/:slug/settings/devices`) pages — list + detail panel + onboarding
 * empty state, filtered to the given `scope`.
 */
const DeviceManager = memo<DeviceManagerProps>(({ onConnect, scope }) => {
  const { t } = useTranslation('setting');
  const isWorkspace = scope === 'workspace';

  // Fetch via SWR so the cache key carries the active workspace id (see
  // `DEVICE_LIST_SWR_KEY`). The raw TRPC React Query key had no workspace
  // dimension, so a fetch primed while the workspace was still resolving (empty
  // `X-Workspace-Id` header → personal pool) stuck for the whole session and the
  // workspace list rendered empty until a hard refresh.
  // Devices come from an authed lambda procedure, so only query once signed in
  // (desktop always queries — it lists the local device's registered cwd).
  const isLogin = useUserStore(authSelectors.isLogin);
  const { data, isLoading, error, mutate } = useClientDataSWR(
    isLogin || isDesktop ? [DEVICE_LIST_SWR_KEY] : null,
    () => deviceService.listDevices(),
  );
  // `listDevices` is workspace-aware and returns both pools — keep each surface
  // to its own scope.
  const devices = (data ?? []).filter((d) => d.scope === scope);

  // The machine the user is on right now (desktop only) — personal pool only;
  // a workspace device is never "this machine" in the personal sense.
  const useFetchDeviceInfo = useElectronStore((s) => s.useFetchGatewayDeviceInfo);
  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  useFetchDeviceInfo();
  const currentDeviceId = !isWorkspace && isDesktop ? gatewayDeviceInfo?.deviceId : undefined;

  const [selectedId, setSelectedId] = useState<string>();
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());

  // Bulk remove routes by the managed scope (the list is single-scope), mirroring
  // the per-row mutation choice in `DeviceItem`.
  const removePersonal = lambdaQuery.device.removeDevice.useMutation();
  const removeWorkspace = lambdaQuery.device.removeWorkspaceDevice.useMutation();
  const removeMutation = isWorkspace ? removeWorkspace : removePersonal;

  // Hook must run before any early return so render order stays stable.
  const canEditDevice = useCanEditDevice();

  // ─── Empty state: onboarding hero + connect options + capabilities ───
  // Now gated by AsyncBoundary so a *failed* device fetch renders a failure +
  // Retry instead of this "connect your first device" onboarding (which falsely
  // told the user they own no devices — ux Read §1.1 error-as-empty trap).
  const emptyState = (
    <Flexbox gap={32}>
      <Flexbox className={styles.emptyCard}>
        <Flexbox align={'center'} className={styles.emptyHero} gap={12}>
          <span className={styles.heroIcon}>
            <Icon icon={isWorkspace ? ServerIcon : MonitorDownIcon} size={28} />
          </span>
          <Text fontSize={18} weight={600}>
            {t(isWorkspace ? 'workspaceSetting.devices.heroTitle' : 'devices.empty.title')}
          </Text>
          <Text style={{ maxWidth: 440 }} type={'secondary'}>
            {t(isWorkspace ? 'workspaceSetting.devices.heroDesc' : 'devices.empty.desc')}
          </Text>
        </Flexbox>

        <div className={isWorkspace ? undefined : styles.optionGrid}>
          {!isWorkspace && (
            <ConnectOption
              badge={t('devices.empty.methodDesktop.badge')}
              desc={t('devices.empty.methodDesktop.desc')}
              icon={MonitorDownIcon}
              title={t('devices.empty.methodDesktop.title')}
              onClick={() => onConnect('desktop')}
            />
          )}
          <ConnectOption
            desc={t('devices.empty.methodCli.desc')}
            icon={TerminalIcon}
            title={t('devices.empty.methodCli.title')}
            onClick={() => onConnect('cli')}
          />
        </div>
      </Flexbox>

      <Capabilities />
    </Flexbox>
  );

  const selected = selectedId ? devices.find((d) => d.deviceId === selectedId) : undefined;
  const isCurrent = (id: string) => !!currentDeviceId && id === currentDeviceId;

  // Bulk-selection set excludes rows the user can't edit so the toolbar only
  // ever offers actions the server would actually accept, mirroring the
  // self-or-owner gate. `canEditDevice` is a stable callback so deriving from
  // it on render is fine.
  const editableDevices = devices.filter((d) => canEditDevice(d));

  // Only count ids that still exist in the current scope's editable list, so a
  // stale tick (e.g. a device removed elsewhere) never inflates the toolbar
  // count.
  const checkedCount = editableDevices.filter((d) => checkedIds.has(d.deviceId)).length;
  const allChecked = editableDevices.length > 0 && checkedCount === editableDevices.length;
  const someChecked = checkedCount > 0 && !allChecked;
  const selectionActive = checkedCount > 0;

  const toggleChecked = (deviceId: string, next: boolean) =>
    setCheckedIds((prev) => {
      const draft = new Set(prev);
      if (next) draft.add(deviceId);
      else draft.delete(deviceId);
      return draft;
    });

  const toggleAll = () =>
    setCheckedIds(allChecked ? new Set() : new Set(editableDevices.map((d) => d.deviceId)));

  const handleBulkRemove = () => {
    const ids = editableDevices.filter((d) => checkedIds.has(d.deviceId)).map((d) => d.deviceId);
    if (ids.length === 0) return;
    confirmModal({
      content: t('devices.remove.confirmManyDesc', { count: ids.length }),
      okButtonProps: { danger: true },
      okText: t('devices.actions.removeSelected', { count: ids.length }),
      onOk: async () => {
        await Promise.all(ids.map((deviceId) => removeMutation.mutateAsync({ deviceId })));
        await refreshDeviceList();
        setCheckedIds(new Set());
        if (selectedId && ids.includes(selectedId)) setSelectedId(undefined);
      },
      title: t('devices.remove.confirmMany', { count: ids.length }),
    });
  };

  return (
    <AsyncBoundary
      data={data}
      empty={emptyState}
      error={error}
      errorVariant={'block'}
      isEmpty={devices.length === 0}
      isLoading={isLoading}
      loading={<ListSkeleton />}
      onRetry={() => mutate()}
    >
      <Flexbox horizontal align={'flex-start'} gap={16}>
        <Flexbox className={styles.listCol} flex={1}>
          <Flexbox
            horizontal
            align={'center'}
            className={styles.listHeader}
            justify={'space-between'}
          >
            <Flexbox
              horizontal
              align={'center'}
              className={editableDevices.length > 0 ? styles.selectAll : undefined}
              gap={8}
              onClick={editableDevices.length > 0 ? toggleAll : undefined}
            >
              {editableDevices.length > 0 && (
                <Checkbox checked={allChecked} indeterminate={someChecked} />
              )}
              <Text fontSize={12} type={'secondary'} weight={500}>
                {selectionActive
                  ? t('devices.selection.selected', { count: checkedCount })
                  : t('devices.selection.total', { count: devices.length })}
              </Text>
            </Flexbox>
            {selectionActive && (
              <Button
                danger
                icon={<Icon icon={Trash2Icon} />}
                loading={removeMutation.isPending}
                size={'small'}
                onClick={handleBulkRemove}
              >
                {t('devices.actions.removeSelected', { count: checkedCount })}
              </Button>
            )}
          </Flexbox>
          <Flexbox className={styles.listScroll} gap={2} padding={4}>
            {devices.map((device) => {
              const editable = canEditDevice(device);
              return (
                <DeviceItem
                  checked={checkedIds.has(device.deviceId)}
                  device={device}
                  isCurrent={isCurrent(device.deviceId)}
                  key={device.deviceId}
                  selected={device.deviceId === selectedId}
                  selectionActive={selectionActive}
                  // Withholding the handler also withholds the checkbox; non-
                  // editable rows render without a tick so bulk selection only
                  // ever includes devices the server would accept.
                  onCheckChange={
                    editable ? (next) => toggleChecked(device.deviceId, next) : undefined
                  }
                  onSelect={() =>
                    setSelectedId((prev) =>
                      prev === device.deviceId ? undefined : device.deviceId,
                    )
                  }
                />
              );
            })}
          </Flexbox>
        </Flexbox>
        {selected && (
          <Flexbox className={styles.detailCol} flex={1}>
            {/* keyed on deviceId so the form state resets when the selection changes */}
            <DeviceDetailPanel
              device={selected}
              isCurrent={isCurrent(selected.deviceId)}
              key={selected.deviceId}
              onClose={() => setSelectedId(undefined)}
            />
          </Flexbox>
        )}
      </Flexbox>
    </AsyncBoundary>
  );
});

DeviceManager.displayName = 'DeviceManager';

export default DeviceManager;
