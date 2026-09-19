'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox, Form, Icon } from '@lobehub/ui';
import { ActionIcon, Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { MonitorUpIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import {
  DeviceConnectModal,
  DeviceDetailPanel,
  DeviceManager,
  useDeviceList,
} from '@/features/DeviceManager';
import { useElectronStore } from '@/store/electron';

const styles = createStaticStyles(({ css }) => ({
  detailPane: css`
    overflow: hidden;
    align-self: stretch;

    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  listPane: css`
    flex: 0 1 1024px;
    min-width: 400px;
  `,
}));

const Page = memo(() => {
  const { t } = useTranslation('setting');
  const [open, setOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<'cli' | 'desktop'>();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>();
  // Shares DeviceManager's SWR entry, so the header actions drive the list it
  // renders — the same wiring the workspace devices page uses.
  const { data, isValidating, mutate } = useDeviceList();

  const handleConnect = (tab?: 'cli' | 'desktop') => {
    setInitialTab(tab);
    setOpen(true);
  };

  const devices = (data ?? []).filter((device) => device.scope === 'personal');
  const selectedDevice = devices.find((device) => device.deviceId === selectedDeviceId);

  const useFetchDeviceInfo = useElectronStore((s) => s.useFetchGatewayDeviceInfo);
  const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
  useFetchDeviceInfo();
  const currentDeviceId = isDesktop ? gatewayDeviceInfo?.deviceId : undefined;

  return (
    <>
      <Flexbox horizontal align={'flex-start'} gap={16} width={'100%'}>
        <Form
          className={styles.listPane}
          collapsible={false}
          itemsType={'group'}
          variant={'filled'}
          items={[
            {
              children: (
                <DeviceManager
                  inlineDetail={false}
                  scope={'personal'}
                  selectedDeviceId={selectedDeviceId}
                  onConnect={handleConnect}
                  onSelectedDeviceChange={setSelectedDeviceId}
                />
              ),
              extra: (
                <Flexbox horizontal align={'center'} gap={8}>
                  {devices.length > 0 && (
                    <Text fontSize={12} type={'secondary'} weight={500}>
                      {t('devices.selection.total', { count: devices.length })}
                    </Text>
                  )}
                  <Button
                    icon={<Icon icon={MonitorUpIcon} />}
                    size={'small'}
                    onClick={() => handleConnect()}
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
              ),
              title: t('devices.title'),
            },
          ]}
          {...FORM_STYLE}
        />

        {selectedDevice && (
          <Flexbox className={styles.detailPane} flex={1}>
            <DeviceDetailPanel
              device={selectedDevice}
              isCurrent={selectedDevice.deviceId === currentDeviceId}
              key={selectedDevice.deviceId}
              onClose={() => setSelectedDeviceId(undefined)}
            />
          </Flexbox>
        )}
      </Flexbox>

      <DeviceConnectModal
        initialTab={initialTab}
        open={open}
        scope={'personal'}
        onClose={() => setOpen(false)}
      />
    </>
  );
});

Page.displayName = 'DevicesSettings';

export default Page;
