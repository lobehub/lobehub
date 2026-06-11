'use client';

import { DOWNLOAD_URL, isDesktop } from '@lobechat/const';
import { Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { MonitorDownIcon, TerminalIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';
import { useElectronStore } from '@/store/electron';

import ConnectDeviceModal from './ConnectDeviceModal';
import DeviceDetailPanel from './DeviceDetailPanel';
import DeviceItem from './DeviceItem';

const styles = createStaticStyles(({ css }) => ({
  detailCol: css`
    align-self: stretch;
    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  empty: css`
    padding-block: 48px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  emptyCard: css`
    padding: 32px 24px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG}px;

    background: ${cssVar.colorFillQuaternary};
  `,
  link: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    padding: 8px 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius}px;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    text-decoration: none;

    background: ${cssVar.colorBgContainer};
    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorPrimary};
      border-color: ${cssVar.colorPrimaryBorder};
      background: ${cssVar.colorPrimaryBg};
    }
  `,
  listCol: css`
    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  subtitle: css`
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const DeviceList = memo(() => {
  const { t } = useTranslation('setting');
  const { data: devices, isLoading } = lambdaQuery.device.listDevices.useQuery(undefined, {
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
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  if (isLoading) return <Skeleton active paragraph={{ rows: 4 }} title={false} />;

  if (!devices || devices.length === 0)
    return (
      <>
        <Flexbox align={'center'} className={styles.empty} gap={24} justify={'center'}>
          <Flexbox className={styles.emptyCard} gap={16} style={{ maxWidth: 440 }}>
            <Text style={{ fontSize: 16, fontWeight: 500 }}>
              {t('devices.empty.title')}
            </Text>
            <Text className={styles.subtitle}>{t('devices.empty.desc')}</Text>

            <Flexbox gap={12}>
              {/* Method 1: Desktop App */}
              <a
                className={styles.link}
                href={DOWNLOAD_URL.default}
                rel="noreferrer"
                target="_blank"
              >
                <Icon icon={MonitorDownIcon} size={16} />
                <Flexbox gap={2}>
                  <Text style={{ fontSize: 13, fontWeight: 500 }}>
                    {t('devices.empty.methodDesktop.title')}
                  </Text>
                  <Text className={styles.subtitle} style={{ fontSize: 12 }}>
                    {t('devices.empty.methodDesktop.desc')}
                  </Text>
                </Flexbox>
              </a>

              {/* Method 2: CLI */}
              <div className={styles.link} onClick={() => setConnectModalOpen(true)}>
                <Icon icon={TerminalIcon} size={16} />
                <Flexbox gap={2}>
                  <Text style={{ fontSize: 13, fontWeight: 500 }}>
                    {t('devices.empty.methodCli.title')}
                  </Text>
                  <Text className={styles.subtitle} style={{ fontSize: 12 }}>
                    {t('devices.empty.methodCli.desc')}
                  </Text>
                </Flexbox>
              </div>
            </Flexbox>
          </Flexbox>
        </Flexbox>

        <ConnectDeviceModal
          onClose={() => setConnectModalOpen(false)}
          open={connectModalOpen}
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
