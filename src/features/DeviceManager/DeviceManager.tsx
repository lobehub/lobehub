'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceScope, DeviceVisibility } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ChevronRightIcon,
  FolderCogIcon,
  type LucideIcon,
  MonitorDownIcon,
  MonitorUpIcon,
  RefreshCwIcon,
  ServerIcon,
  TerminalIcon,
  ZapIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useElectronStore } from '@/store/electron';

import DeviceDetailPanel from './DeviceDetailPanel';
import DeviceItem from './DeviceItem';
import { useDeviceList } from './useDeviceList';

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

    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

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
// `withHeader` mirrors the personal page's count/connect header row; the
// workspace page has no list header (its actions live in the page's tab row).
const ListSkeleton = memo<{ withHeader?: boolean }>(({ withHeader }) => (
  <Flexbox className={styles.listCol} flex={1}>
    {withHeader && (
      <Flexbox horizontal align={'center'} className={styles.listHeader}>
        <Skeleton.Button active size={'small'} style={{ height: 16, minWidth: 80, width: 80 }} />
      </Flexbox>
    )}
    <Flexbox gap={2} padding={4}>
      {[0, 1, 2, 3].map((i) => (
        <Flexbox horizontal align={'center'} gap={16} key={i} style={{ padding: 12 }}>
          <Skeleton.Avatar active shape={'square'} size={48} />
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
  /** Open the enrollment wizard (the modal is owned by the route). */
  onConnect: (tab?: 'cli' | 'desktop') => void;
  /** Which device pool this surface manages. */
  scope: DeviceScope;
  /**
   * Workspace scope only: narrow the list to one visibility tab — 'public'
   * (shared pool) or 'private' (the caller's own private enrollments). Omitted
   * → no visibility filtering (personal page).
   */
  visibility?: DeviceVisibility;
}

/**
 * Master-detail device manager shared by the personal (`/settings/devices`) and
 * workspace (`/:slug/settings/devices`) pages — list + detail panel + onboarding
 * empty state, filtered to the given `scope` (and, for workspace, the active
 * visibility tab).
 */
const DeviceManager = memo<DeviceManagerProps>(({ onConnect, scope, visibility }) => {
  const { t } = useTranslation('setting');
  const isWorkspace = scope === 'workspace';

  // Workspace-keyed SWR fetch — the shared hook every device-listing surface
  // uses (see `useDeviceList` for why the raw TRPC React Query path is wrong).
  const { data, isLoading, error, mutate, isValidating } = useDeviceList();
  // `listDevices` is workspace-aware and returns both pools — keep each surface
  // to its own scope (and visibility tab). Ghost rows (`visibility: null`,
  // online but unregistered) belong to the shared pool: the server already
  // strips other members' private devices, so an unclaimed live connection can
  // only be a public-pool machine.
  const devices = (data ?? []).filter(
    (d) => d.scope === scope && (!visibility || (d.visibility ?? 'public') === visibility),
  );

  // The machine the user is on right now (desktop only) — personal pool only;
  // a workspace device is never "this machine" in the personal sense.
  const useFetchDeviceInfo = useElectronStore((s) => s.useFetchGatewayDeviceInfo);
  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  useFetchDeviceInfo();
  const currentDeviceId = !isWorkspace && isDesktop ? gatewayDeviceInfo?.deviceId : undefined;

  const [selectedId, setSelectedId] = useState<string>();

  // ─── Empty state: onboarding hero + connect options + capabilities ───
  // Now gated by AsyncBoundary so a *failed* device fetch renders a failure +
  // Retry instead of this "connect your first device" onboarding (which falsely
  // told the user they own no devices — ux Read §1.1 error-as-empty trap).
  // Workspace machines are headless (CLI-only enrollment), so that scope gets
  // a single primary button instead of the personal page's connect-method
  // cards + capabilities. The copy is pool-agnostic; only the hero icon forks
  // between the shared (server) and private (own machine) pools.
  const isPrivatePool = isWorkspace && visibility === 'private';
  const emptyState = (
    <Flexbox gap={32}>
      <Flexbox className={styles.emptyCard}>
        <Flexbox align={'center'} className={styles.emptyHero} gap={12}>
          <span className={styles.heroIcon}>
            <Icon icon={isWorkspace && !isPrivatePool ? ServerIcon : MonitorDownIcon} size={28} />
          </span>
          <Text fontSize={18} weight={600}>
            {t(isWorkspace ? 'workspaceSetting.devices.heroTitle' : 'devices.empty.title')}
          </Text>
          <Text style={{ maxWidth: 440 }} type={'secondary'}>
            {t(isWorkspace ? 'workspaceSetting.devices.heroDesc' : 'devices.empty.desc')}
          </Text>
          {isWorkspace && (
            <Button
              icon={<Icon icon={TerminalIcon} />}
              style={{ marginBlockStart: 8 }}
              type={'primary'}
              onClick={() => onConnect('cli')}
            >
              {t('devices.empty.methodCli.title')}
            </Button>
          )}
        </Flexbox>

        {!isWorkspace && (
          <div className={styles.optionGrid}>
            <ConnectOption
              badge={t('devices.empty.methodDesktop.badge')}
              desc={t('devices.empty.methodDesktop.desc')}
              icon={MonitorDownIcon}
              title={t('devices.empty.methodDesktop.title')}
              onClick={() => onConnect('desktop')}
            />
            <ConnectOption
              desc={t('devices.empty.methodCli.desc')}
              icon={TerminalIcon}
              title={t('devices.empty.methodCli.title')}
              onClick={() => onConnect('cli')}
            />
          </div>
        )}
      </Flexbox>

      {!isWorkspace && <Capabilities />}
    </Flexbox>
  );

  const selected = selectedId ? devices.find((d) => d.deviceId === selectedId) : undefined;
  const isCurrent = (id: string) => !!currentDeviceId && id === currentDeviceId;

  return (
    <AsyncBoundary
      data={data}
      empty={emptyState}
      error={error}
      errorVariant={'block'}
      isEmpty={devices.length === 0}
      isLoading={isLoading}
      loading={<ListSkeleton withHeader={!isWorkspace} />}
      onRetry={() => mutate()}
    >
      <Flexbox horizontal align={'flex-start'} gap={16}>
        <Flexbox className={styles.listCol} flex={1}>
          {/* Workspace scope has no list header — its connect + refresh actions
              live in the page's tab row (beside the visibility tabs). */}
          {!isWorkspace && (
            <Flexbox
              horizontal
              align={'center'}
              className={styles.listHeader}
              justify={'space-between'}
            >
              <Text fontSize={12} type={'secondary'} weight={500}>
                {t('devices.selection.total', { count: devices.length })}
              </Text>
              <Flexbox horizontal align={'center'} gap={8}>
                <Button
                  icon={<Icon icon={MonitorUpIcon} />}
                  size={'small'}
                  onClick={() => onConnect()}
                >
                  {t('devices.connectWizard.button')}
                </Button>
                <ActionIcon
                  icon={RefreshCwIcon}
                  loading={isValidating}
                  size={'small'}
                  title={t('devices.actions.refresh')}
                  onClick={() => mutate()}
                />
              </Flexbox>
            </Flexbox>
          )}
          <Flexbox className={styles.listScroll} gap={2} padding={4}>
            {devices.map((device) => (
              <DeviceItem
                device={device}
                isCurrent={isCurrent(device.deviceId)}
                key={device.deviceId}
                selected={device.deviceId === selectedId}
                onSelect={() =>
                  setSelectedId((prev) => (prev === device.deviceId ? undefined : device.deviceId))
                }
              />
            ))}
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
