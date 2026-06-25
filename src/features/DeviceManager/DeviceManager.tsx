'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceScope } from '@lobechat/types';
import { Button, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ChevronRightIcon,
  FolderCogIcon,
  type LucideIcon,
  MonitorDownIcon,
  MonitorUpIcon,
  ServerIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from 'lucide-react';
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { deviceService } from '@/services/device';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { DEVICE_LIST_SWR_KEY } from './const';
import DeviceDetailPanel from './DeviceDetailPanel';
import DeviceItem from './DeviceItem';

const styles = createStaticStyles(({ css }) => ({
  badge: css`
    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  detailPlaceholder: css`
    min-height: 320px;
    padding: 32px;
  `,
  detailCol: css`
    overflow: hidden;
    align-self: stretch;

    min-width: 0;
    min-height: 360px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
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
  managerGrid: css`
    display: grid;
    grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
    gap: 16px;
    align-items: start;

    @media (width <= 920px) {
      grid-template-columns: 1fr;
    }
  `,
  overviewCard: css`
    padding-block: 14px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  overviewGrid: css`
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: 16px;
    align-items: start;

    @media (width <= 860px) {
      grid-template-columns: 1fr;
    }
  `,
  overviewIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  heroIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 56px;
    height: 56px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  listCol: css`
    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  listHeader: css`
    padding-block: 6px 8px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  option: css`
    cursor: pointer;
    padding: 20px;
    background: ${cssVar.colorBgContainer};
    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  optionGrid: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  placeholderIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 52px;
    height: 52px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  placeholderItemIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
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

    background: ${cssVar.colorFillSecondary};
  `,
  subtitle: css`
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  securityList: css`
    margin: 0;
    padding-inline-start: 18px;
    color: ${cssVar.colorTextSecondary};

    li + li {
      margin-block-start: 6px;
    }
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
  <Flexbox horizontal align={'flex-start'} className={styles.option} gap={14} onClick={onClick}>
    <span className={styles.optionIcon}>
      <Icon icon={icon} size={20} />
    </span>
    <Flexbox flex={1} gap={2}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Text style={{ fontSize: 14, fontWeight: 500 }}>{title}</Text>
        {badge && <span className={styles.badge}>{badge}</span>}
      </Flexbox>
      <Text className={styles.subtitle} style={{ fontSize: 12 }}>
        {desc}
      </Text>
    </Flexbox>
    <Icon icon={ChevronRightIcon} size={16} style={{ color: cssVar.colorTextQuaternary }} />
  </Flexbox>
));

interface DeviceOverviewProps {
  scope: DeviceScope;
}

const DeviceOverview = memo<DeviceOverviewProps>(({ scope }) => {
  const { t } = useTranslation('setting');
  const isWorkspace = scope === 'workspace';
  const securityItems = isWorkspace
    ? [
        t('devices.security.workspace.members'),
        t('devices.security.workspace.onlineOnly'),
        t('devices.security.workspace.scope'),
      ]
    : [
        t('devices.security.personal.metadata'),
        t('devices.security.personal.onlineOnly'),
        t('devices.security.personal.stop'),
      ];

  return (
    <div className={styles.overviewCard}>
      <div className={styles.overviewGrid}>
        <Flexbox horizontal align={'flex-start'} gap={12}>
          <span className={styles.overviewIcon}>
            <Icon icon={isWorkspace ? ServerIcon : MonitorDownIcon} size={18} />
          </span>
          <Flexbox gap={4}>
            <Text style={{ fontSize: 14, fontWeight: 600 }}>
              {t(
                isWorkspace
                  ? 'devices.overview.workspace.title'
                  : 'devices.overview.personal.title',
              )}
            </Text>
            <Text className={styles.subtitle} style={{ lineHeight: 1.6 }}>
              {t(
                isWorkspace ? 'devices.overview.workspace.desc' : 'devices.overview.personal.desc',
              )}
            </Text>
          </Flexbox>
        </Flexbox>

        <Flexbox horizontal align={'flex-start'} gap={12}>
          <span className={styles.overviewIcon}>
            <Icon icon={ShieldCheckIcon} size={18} />
          </span>
          <Flexbox gap={6}>
            <Text style={{ fontSize: 14, fontWeight: 600 }}>{t('devices.security.title')}</Text>
            <ul className={styles.securityList}>
              {securityItems.map((item) => (
                <li key={item}>
                  <Text style={{ fontSize: 12, lineHeight: 1.6 }} type={'secondary'}>
                    {item}
                  </Text>
                </li>
              ))}
            </ul>
          </Flexbox>
        </Flexbox>
      </div>
    </div>
  );
});

DeviceOverview.displayName = 'DeviceManager.DeviceOverview';

interface DetailPlaceholderProps {
  scope: DeviceScope;
}

const DetailPlaceholder = memo<DetailPlaceholderProps>(({ scope }) => {
  const { t } = useTranslation('setting');
  const isWorkspace = scope === 'workspace';
  const items: { icon: LucideIcon; text: string }[] = isWorkspace
    ? [
        { icon: TerminalIcon, text: t('devices.placeholder.workspace.connection') },
        { icon: FolderCogIcon, text: t('devices.placeholder.workspace.cwd') },
        { icon: ShieldCheckIcon, text: t('devices.placeholder.workspace.security') },
      ]
    : [
        { icon: TerminalIcon, text: t('devices.placeholder.connection') },
        { icon: FolderCogIcon, text: t('devices.placeholder.cwd') },
        { icon: ShieldCheckIcon, text: t('devices.placeholder.security') },
      ];

  return (
    <Flexbox align={'center'} className={styles.detailPlaceholder} gap={18} justify={'center'}>
      <span className={styles.placeholderIcon}>
        <Icon icon={isWorkspace ? ServerIcon : MonitorDownIcon} size={26} />
      </span>
      <Flexbox align={'center'} gap={6}>
        <Text style={{ fontSize: 16, fontWeight: 600 }}>{t('devices.placeholder.title')}</Text>
        <Text
          align={'center'}
          className={styles.subtitle}
          style={{ maxWidth: 360, lineHeight: 1.6 }}
        >
          {t('devices.placeholder.desc')}
        </Text>
      </Flexbox>
      <Flexbox gap={8} style={{ maxWidth: 360, width: '100%' }}>
        {items.map((item) => (
          <Flexbox horizontal align={'center'} gap={10} key={item.text}>
            <span className={styles.placeholderItemIcon}>
              <Icon icon={item.icon} size={14} />
            </span>
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {item.text}
            </Text>
          </Flexbox>
        ))}
      </Flexbox>
    </Flexbox>
  );
});

DetailPlaceholder.displayName = 'DeviceManager.DetailPlaceholder';

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
  const { data, isLoading } = useClientDataSWR(
    isLogin || isDesktop ? [DEVICE_LIST_SWR_KEY] : null,
    () => deviceService.listDevices(),
  );
  // `listDevices` is workspace-aware and returns both pools — keep each surface
  // to its own scope.
  const devices = useMemo(() => (data ?? []).filter((d) => d.scope === scope), [data, scope]);

  // The machine the user is on right now (desktop only) — personal pool only;
  // a workspace device is never "this machine" in the personal sense.
  const useFetchDeviceInfo = useElectronStore((s) => s.useFetchGatewayDeviceInfo);
  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  useFetchDeviceInfo();
  const currentDeviceId = !isWorkspace && isDesktop ? gatewayDeviceInfo?.deviceId : undefined;

  const [selectedId, setSelectedId] = useState<string>();
  const hasAutoSelectedRef = useRef(false);

  useLayoutEffect(() => {
    if (devices.length === 0) {
      if (selectedId) setSelectedId(undefined);
      hasAutoSelectedRef.current = false;
      return;
    }

    if (selectedId && !devices.some((device) => device.deviceId === selectedId)) {
      setSelectedId(undefined);
      hasAutoSelectedRef.current = false;
      return;
    }

    if (selectedId || hasAutoSelectedRef.current) return;

    const currentDevice = currentDeviceId
      ? devices.find((device) => device.deviceId === currentDeviceId)
      : undefined;
    const autoSelectedDevice = currentDevice ?? (devices.length === 1 ? devices[0] : undefined);

    if (autoSelectedDevice) {
      setSelectedId(autoSelectedDevice.deviceId);
      hasAutoSelectedRef.current = true;
    }
  }, [currentDeviceId, devices, selectedId]);

  if (isLoading) return <Skeleton active paragraph={{ rows: 4 }} title={false} />;

  // ─── Empty state: onboarding hero + connect options ───
  if (devices.length === 0) {
    return (
      <Flexbox className={styles.emptyCard}>
        <Flexbox align={'center'} className={styles.emptyHero} gap={12}>
          <span className={styles.heroIcon}>
            <Icon icon={isWorkspace ? ServerIcon : MonitorDownIcon} size={28} />
          </span>
          <Text style={{ fontSize: 18, fontWeight: 600 }}>
            {t(isWorkspace ? 'workspaceSetting.devices.heroTitle' : 'devices.empty.title')}
          </Text>
          <Text className={styles.subtitle} style={{ maxWidth: 440 }}>
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
    );
  }

  const selected = selectedId ? devices.find((d) => d.deviceId === selectedId) : undefined;
  const isCurrent = (id: string) => !!currentDeviceId && id === currentDeviceId;

  return (
    <Flexbox gap={20}>
      <DeviceOverview scope={scope} />

      <div className={styles.managerGrid}>
        <Flexbox className={styles.listCol} padding={4}>
          <Flexbox
            horizontal
            align={'center'}
            className={styles.listHeader}
            distribution={'space-between'}
            gap={12}
          >
            <Text style={{ fontSize: 12, fontWeight: 500 }} type={'secondary'}>
              {t('tab.devices')} · {devices.length}
            </Text>
            <Button
              icon={<Icon icon={MonitorUpIcon} />}
              size={'small'}
              type={'text'}
              onClick={() => onConnect()}
            >
              {t('devices.actions.connectAnother')}
            </Button>
          </Flexbox>
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
        <Flexbox className={styles.detailCol}>
          {selected ? (
            /* keyed on deviceId so the form state resets when the selection changes */
            <DeviceDetailPanel
              device={selected}
              isCurrent={isCurrent(selected.deviceId)}
              key={selected.deviceId}
              onClose={() => setSelectedId(undefined)}
            />
          ) : (
            <DetailPlaceholder scope={scope} />
          )}
        </Flexbox>
      </div>
    </Flexbox>
  );
});

DeviceManager.displayName = 'DeviceManager';

export default DeviceManager;
