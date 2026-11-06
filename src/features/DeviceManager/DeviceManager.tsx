'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceScope, DeviceVisibility } from '@lobechat/types';
import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useDeviceList } from '@/store/device';
import { useElectronStore } from '@/store/electron';

import DeviceCard from './DeviceCard';
import DeviceGrid from './DeviceGrid';
import { getDeviceListBoundary } from './deviceListBoundary';
import { DeviceGridSkeleton } from './Skeleton';

const styles = stylex.create({
  badge: {
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: cssVar.fontSizeSM,
    fontWeight: 500,
    color: cssVar.colorPrimary,
    backgroundColor: cssVar.colorPrimaryBg,
    backgroundImage: 'none',
  },
  capabilityCard: {
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  capabilityIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  emptyCard: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  emptyHero: {
    paddingBlock: '40px',
    paddingInline: '32px',
    textAlign: 'center',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  heroIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '56px',
    height: '56px',
    borderRadius: cssVar.borderRadiusLG,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  option: {
    cursor: 'pointer',
    padding: '20px',
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: {
      'default': 'background 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-2px' },
  },
  optionGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  optionIcon: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

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
    className={stylex.props(styles.option).className}
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
    <span {...stylex.props(styles.optionIcon)}>
      <Icon icon={icon} size={20} />
    </span>
    <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Text weight={500}>{title}</Text>
        {badge && <span {...stylex.props(styles.badge)}>{badge}</span>}
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
          <Flexbox
            className={stylex.props(styles.capabilityCard).className}
            flex={1}
            gap={12}
            key={cap.title}
          >
            <span {...stylex.props(styles.capabilityIcon)}>
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
  /**
   * Left side of the toolbar — the workspace page puts its visibility tabs
   * here; the personal page has a single pool and leaves it empty.
   */
  toolbarLeading?: ReactNode;
  /**
   * Workspace scope only: narrow the list to one visibility tab — 'public'
   * (shared pool) or 'private' (the caller's own private enrollments). Omitted
   * → no visibility filtering (personal page).
   */
  visibility?: DeviceVisibility;
}

/**
 * Device list shared by the personal (`/settings/devices`) and workspace
 * (`/:slug/settings/devices`) pages — toolbar (refresh + connect) above the
 * card grid / onboarding empty state, filtered to the given `scope` (and, for
 * workspace, the active visibility tab). A card opens the device's detail
 * page; the host owns that route.
 */
const DeviceManager = memo<DeviceManagerProps>((props) => {
  const { onConnect, onOpenDevice, scope, toolbarLeading, visibility } = props;
  const { t } = useTranslation('setting');
  const isWorkspace = scope === 'workspace';

  // The device replica every device-listing surface reads (see `useDeviceList`):
  // a reload paints the persisted cards first, presence pending.
  const deviceList = useDeviceList();
  const { data, isValidating, error, mutate } = deviceList;
  // `listDevices` is workspace-aware and returns both pools — keep each surface
  // to its own scope (and visibility tab). Ghost rows (`visibility: null`,
  // online but unregistered) belong to the shared pool: the server already
  // strips other members' private devices, so an unclaimed live connection can
  // only be a public-pool machine.
  const devices = (data ?? []).filter(
    (d) => d.scope === scope && (!visibility || (d.visibility ?? 'public') === visibility),
  );
  // A persisted copy with no row for this pool / tab is not proof the pool is
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
  // between the shared (server) and private (own machine) pools.
  const isPrivatePool = isWorkspace && visibility === 'private';
  const emptyState = (
    <Flexbox gap={32}>
      <Flexbox className={stylex.props(styles.emptyCard).className}>
        <Flexbox align={'center'} className={stylex.props(styles.emptyHero).className} gap={12}>
          <span {...stylex.props(styles.heroIcon)}>
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
          <div {...stylex.props(styles.optionGrid)}>
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
  const toolbar = (
    <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
      <div style={{ minWidth: 0 }}>{toolbarLeading}</div>
      <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none' }}>
        <Button
          icon={<Icon icon={RefreshCwIcon} />}
          loading={isValidating}
          title={t('devices.actions.refresh')}
          onClick={() => mutate()}
        />
        {isWorkspace ? (
          <Button
            icon={<Icon icon={TerminalIcon} />}
            type={'primary'}
            onClick={() => onConnect('cli')}
          >
            {t('devices.empty.methodCli.title')}
          </Button>
        ) : (
          <Button icon={<Icon icon={MonitorUpIcon} />} type={'primary'} onClick={() => onConnect()}>
            {t('devices.connectWizard.button')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
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
      <DeviceGrid>
        {devices.map((device) => (
          <DeviceCard
            device={device}
            isCurrent={isCurrent(device.deviceId)}
            key={device.deviceId}
            onOpen={() => onOpenDevice(device.deviceId)}
          />
        ))}
      </DeviceGrid>
    </AsyncBoundary>
  );

  return (
    <Flexbox gap={16}>
      {toolbar}
      {list}
    </Flexbox>
  );
});

DeviceManager.displayName = 'DeviceManager';

export default DeviceManager;
