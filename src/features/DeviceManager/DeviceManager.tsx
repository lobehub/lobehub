'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceScope, DeviceVisibility } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  createStaticStyles,
  cssVar,
  Empty,
  Flexbox,
  Icon,
  Text,
} from '@lobehub/ui';
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

import ManagedDeviceCreateEntry from '@/business/client/features/ManagedDeviceCreateEntry';
import AsyncBoundary from '@/components/AsyncBoundary';
import VisibilityFilter, {
  matchesVisibilityFilter,
  type VisibilityFilterValue,
} from '@/components/VisibilityFilter';
import SettingsPageActions from '@/features/Settings/features/SettingsPageActions';
import { useDeviceList } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { densityVars } from '@/styles/densityVars';

import DeviceCard from './DeviceCard';
import DeviceGrid from './DeviceGrid';
import { getDeviceListBoundary } from './deviceListBoundary';
import { DeviceGridSkeleton } from './Skeleton';

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
    padding: ${densityVars.cardPadding};
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

interface DeviceManagerProps {
  /** Open the enrollment wizard (the modal is owned by the route). */
  onConnect: (tab?: 'cli' | 'desktop') => void;
  /** Open a device's detail page (the `devices/:sub` route is owned by the host). */
  onOpenDevice: (deviceId: string) => void;
  /** Which device pool this surface manages. */
  scope: DeviceScope;
}

/**
 * Device list shared by the personal (`/settings/devices`) and workspace
 * (`/:slug/settings/devices`) pages — toolbar (refresh + connect) above the
 * card grid / onboarding empty state, filtered to the given `scope`. The workspace
 * list holds the shared pool and the caller's private devices together, the
 * private ones marked with a lock on their card. A card opens the device's detail
 * page; the host owns that route.
 */
const DeviceManager = memo<DeviceManagerProps>((props) => {
  const { onConnect, onOpenDevice, scope } = props;
  const { t } = useTranslation('setting');
  const isWorkspace = scope === 'workspace';
  // The `managed_cloud_device` flag gates only the entry that creates a managed
  // device. Managed devices that already exist still list and open here.
  const showManagedDeviceCreate = useServerConfigStore(
    serverConfigSelectors.enableManagedCloudDevice,
  );

  // The device replica every device-listing surface reads (see `useDeviceList`):
  // a reload paints the persisted cards first, presence pending.
  const deviceList = useDeviceList();
  const { data, isValidating, error, mutate } = deviceList;
  // `listDevices` is workspace-aware and returns both scopes — keep each
  // surface to its own. In a workspace the server already strips other
  // members' private devices, so both visibility pools list here together.
  const devices = (data ?? []).filter((d) => d.scope === scope);
  // Workspace only: narrow the one list to private or shared devices.
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilterValue>('all');
  const isPrivateDevice = (d: (typeof devices)[number]) => d.visibility === 'private';
  const showVisibilityFilter = isWorkspace && devices.length > 0;
  const visibleDevices = showVisibilityFilter
    ? devices.filter((d) => matchesVisibilityFilter(isPrivateDevice(d), visibilityFilter))
    : devices;
  // A device connected from here starts private; its card menu publishes it.
  const createVisibility: DeviceVisibility | undefined = isWorkspace ? 'private' : undefined;
  // A persisted copy with no row for this scope is not proof the pool is
  // empty: wait for the server (or its error) before showing onboarding.
  const boundary = getDeviceListBoundary(deviceList, devices.length === 0);

  // The machine the user is on right now (desktop only) — personal pool only;
  // a workspace device is never "this machine" in the personal sense.
  const useFetchDeviceInfo = useElectronStore((s) => s.useFetchGatewayDeviceInfo);
  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  useFetchDeviceInfo();
  const currentDeviceId = !isWorkspace && isDesktop ? gatewayDeviceInfo?.deviceId : undefined;

  // ─── Empty state: onboarding hero + connect options + capabilities ───
  // Now gated by AsyncBoundary so a *failed* device fetch renders a failure +
  // Retry instead of this "connect your first device" onboarding (which falsely
  // told the user they own no devices — ux Read §1.1 error-as-empty trap).
  // Workspace machines are headless (CLI-only enrollment), so that scope gets
  // a single primary button instead of the personal page's connect-method
  // cards + capabilities. The copy is pool-agnostic; only the hero icon forks
  // between the workspace (server) and personal (own machine) pages.
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
          {showManagedDeviceCreate && (
            <ManagedDeviceCreateEntry
              placement={'empty'}
              scope={scope}
              visibility={createVisibility}
            />
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

  const isCurrent = (id: string) => !!currentDeviceId && id === currentDeviceId;

  // Workspace machines are headless, so that pool enrolls through the CLI
  // only; the personal wizard also offers the desktop app.
  const renderActions = (size?: 'small') => (
    <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none' }}>
      {showVisibilityFilter && (
        <VisibilityFilter value={visibilityFilter} onChange={setVisibilityFilter} />
      )}
      {showManagedDeviceCreate && (
        <ManagedDeviceCreateEntry
          placement={'toolbar'}
          scope={scope}
          visibility={createVisibility}
        />
      )}
      {isWorkspace ? (
        <Button
          icon={<Icon icon={TerminalIcon} />}
          size={size}
          type={'primary'}
          onClick={() => onConnect('cli')}
        >
          {t('devices.empty.methodCli.title')}
        </Button>
      ) : (
        <Button
          icon={<Icon icon={MonitorUpIcon} />}
          size={size}
          type={'primary'}
          onClick={() => onConnect()}
        >
          {t('devices.connectWizard.button')}
        </Button>
      )}
      {/* Last, as on the subscription accounts page: refreshing is secondary to
          adding a device. */}
      <ActionIcon
        loading={isValidating}
        size={size}
        title={t('devices.actions.refresh')}
        onClick={() => mutate()}
        icon={RefreshCwIcon}
        // A row that runs short of width shrinks its children; the icon keeps its square.
        style={{ flex: 'none' }}
      />
    </Flexbox>
  );

  // How many devices the filter leaves, on the left of the toolbar, as the
  // subscription accounts summary does.
  const toolbar = (
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} wrap={'wrap'}>
      <Text fontSize={13} type={'secondary'}>
        {devices.length > 0 && t('devices.summary', { count: visibleDevices.length })}
      </Text>
      {renderActions()}
    </Flexbox>
  );

  // The actions join the shared settings header instead of leaving a
  // half-empty toolbar row; hosts without that header (workspace settings,
  // mobile) keep the toolbar.
  const toolbarSlot = (
    <SettingsPageActions fallback={toolbar}>{renderActions()}</SettingsPageActions>
  );

  const list = (
    <AsyncBoundary
      data={boundary.data}
      empty={emptyState}
      error={error}
      errorVariant={'block'}
      isEmpty={devices.length === 0}
      isLoading={boundary.isLoading}
      loading={<DeviceGridSkeleton />}
      onRetry={() => mutate()}
    >
      {visibleDevices.length === 0 ? (
        <Empty
          description={t('visibilityFilter.empty', { ns: 'common' })}
          style={{ paddingBlock: 48 }}
        />
      ) : (
        <DeviceGrid>
          {visibleDevices.map((device) => (
            <DeviceCard
              device={device}
              isCurrent={isCurrent(device.deviceId)}
              key={device.deviceId}
              onOpen={() => onOpenDevice(device.deviceId)}
            />
          ))}
        </DeviceGrid>
      )}
    </AsyncBoundary>
  );

  return (
    <Flexbox gap={16}>
      {toolbarSlot}
      {list}
    </Flexbox>
  );
});

DeviceManager.displayName = 'DeviceManager';

export default DeviceManager;
