'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';
import { useElectronStore } from '@/store/electron';

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
  listCol: css`
    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
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

  if (isLoading) return <Skeleton active paragraph={{ rows: 4 }} title={false} />;

  if (!devices || devices.length === 0)
    return (
      <Flexbox align={'center'} className={styles.empty} justify={'center'}>
        <Text type={'secondary'}>{t('devices.empty')}</Text>
      </Flexbox>
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
