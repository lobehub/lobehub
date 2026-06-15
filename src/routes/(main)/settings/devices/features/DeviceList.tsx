'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ChevronRightIcon,
  FolderCogIcon,
  type LucideIcon,
  MonitorDownIcon,
  ShieldCheckIcon,
  TerminalIcon,
  ZapIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import ConnectDeviceModal from './ConnectDeviceModal';
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
  capabilityCard: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition: border-color 0.2s;

    &:hover {
      border-color: ${cssVar.colorPrimaryBorder};
    }
  `,
  capabilityIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillSecondary};
  `,
  detailCol: css`
    align-self: stretch;
    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
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

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  listCol: css`
    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
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

const DeviceList = memo(() => {
  const { t } = useTranslation('setting');
  // Devices come from an authed lambda procedure, so only query once signed in
  // (desktop always queries — it lists the local device's registered cwd).
  const isLogin = useUserStore(authSelectors.isLogin);
  const { data: devices, isLoading } = lambdaQuery.device.listDevices.useQuery(undefined, {
    enabled: isLogin || isDesktop,
    staleTime: 30_000,
  });

  // Identify which row is the machine the user is on right now (desktop only —
  // the web client isn't itself a registered device), so it can be badged and
  // offered a native folder picker for its working directory.
  const useFetchDeviceInfo = useElectronStore((s) => s.useFetchGatewayDeviceInfo);
  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  useFetchDeviceInfo();
  const currentDeviceId = isDesktop ? gatewayDeviceInfo?.deviceId : undefined;

  // No device is selected by default — the detail panel only appears once the
  // user clicks a row.
  const [selectedId, setSelectedId] = useState<string>();
  const [connectTab, setConnectTab] = useState<'cli' | 'desktop'>();

  const openConnect = (tab: 'cli' | 'desktop') => setConnectTab(tab);

  if (isLoading) return <Skeleton active paragraph={{ rows: 4 }} title={false} />;

  if (!devices || devices.length === 0)
    return (
      <>
        <Flexbox gap={32}>
          {/* Onboarding card: hero + the two real connection methods */}
          <Flexbox className={styles.emptyCard}>
            <Flexbox align={'center'} className={styles.emptyHero} gap={12}>
              <span className={styles.heroIcon}>
                <Icon icon={MonitorDownIcon} size={28} />
              </span>
              <Text style={{ fontSize: 18, fontWeight: 600 }}>{t('devices.empty.title')}</Text>
              <Text className={styles.subtitle} style={{ maxWidth: 440 }}>
                {t('devices.empty.desc')}
              </Text>
            </Flexbox>

            <div className={styles.optionGrid}>
              <ConnectOption
                badge={t('devices.empty.methodDesktop.badge')}
                desc={t('devices.empty.methodDesktop.desc')}
                icon={MonitorDownIcon}
                title={t('devices.empty.methodDesktop.title')}
                onClick={() => openConnect('desktop')}
              />
              <ConnectOption
                desc={t('devices.empty.methodCli.desc')}
                icon={TerminalIcon}
                title={t('devices.empty.methodCli.title')}
                onClick={() => openConnect('cli')}
              />
            </div>
          </Flexbox>

          {/* Capabilities unlocked once a device is connected */}
          <Flexbox gap={16}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Icon icon={ShieldCheckIcon} size={16} style={{ color: cssVar.colorPrimary }} />
              <Text style={{ fontSize: 14, fontWeight: 500 }}>
                {t('devices.capabilities.title')}
              </Text>
            </Flexbox>
            <Flexbox horizontal gap={16}>
              {[
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
              ].map((cap) => (
                <Flexbox className={styles.capabilityCard} flex={1} gap={12} key={cap.title}>
                  <span className={styles.capabilityIcon}>
                    <Icon icon={cap.icon} size={18} />
                  </span>
                  <Flexbox gap={2}>
                    <Text style={{ fontSize: 14, fontWeight: 500 }}>{cap.title}</Text>
                    <Text className={styles.subtitle} style={{ fontSize: 12 }}>
                      {cap.desc}
                    </Text>
                  </Flexbox>
                </Flexbox>
              ))}
            </Flexbox>
          </Flexbox>
        </Flexbox>

        <ConnectDeviceModal
          initialTab={connectTab}
          open={!!connectTab}
          onClose={() => setConnectTab(undefined)}
        />
      </>
    );

  const selected = selectedId ? devices.find((d) => d.deviceId === selectedId) : undefined;
  const isCurrent = (id: string) => !!currentDeviceId && id === currentDeviceId;

  return (
    <Flexbox horizontal align={'flex-start'} gap={16}>
      <Flexbox className={styles.listCol} flex={1} padding={4}>
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
  );
});

DeviceList.displayName = 'DeviceList';

export default DeviceList;
