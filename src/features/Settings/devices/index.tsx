'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox, Form, Icon } from '@lobehub/ui';
import { ActionIcon, Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
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
import NavHeader from '@/features/NavHeader';
import RightPanel from '@/features/RightPanel';
import SettingContainer from '@/features/Setting/SettingContainer';
import { useElectronStore } from '@/store/electron';

import KeepAwake from './KeepAwake';

const styles = createStaticStyles(({ css }) => ({
  // The device rows carry their own padding and hover fill; a thin, even inset
  // keeps that fill the same distance from every edge of the card. The Form
  // zeroes the group body's block padding with !important, hence the override.
  listGroup: css`
    .ant-collapse-body {
      padding: 4px !important;
    }
  `,
}));

interface PageProps {
  mobile?: boolean;
}

const Page = memo<PageProps>(({ mobile }) => {
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

  // Narrow viewports have no room beside the list, so the detail stays inside
  // the manager (the master-detail stack DeviceManager owns by default).
  const externalDetail = !mobile;

  const list = (
    <Flexbox gap={24}>
      <Form
        classNames={{ group: styles.listGroup }}
        collapsible={false}
        itemsType={'group'}
        variant={'filled'}
        items={[
          {
            children: (
              <DeviceManager
                inlineDetail={!externalDetail}
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
      {isDesktop && <KeepAwake />}
    </Flexbox>
  );

  const connectModal = (
    <DeviceConnectModal
      initialTab={initialTab}
      open={open}
      scope={'personal'}
      onClose={() => setOpen(false)}
    />
  );

  if (mobile)
    return (
      <>
        {list}
        {connectModal}
      </>
    );

  return (
    <Flexbox horizontal flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <Flexbox flex={1} height={'100%'} style={{ minWidth: 0 }}>
        <NavHeader styles={{ center: { alignItems: 'center' } }}>
          <Text weight={500}>{t('devices.title')}</Text>
        </NavHeader>
        {/* The list keeps the settings reading column — centered at the shared
            1024 max width — so opening the detail only narrows the space it
            centers in, it never turns the page into a left-hugging column. */}
        <SettingContainer maxWidth={1024} paddingBlock={'24px 128px'} paddingInline={24}>
          {list}
        </SettingContainer>
      </Flexbox>
      {/* Page-level rail rather than a card beside the list: the detail is a
          full-height surface with its own scroll, so a device with a long
          working-directory history stays readable without stretching the page. */}
      <RightPanel
        defaultWidth={420}
        expand={!!selectedDevice}
        maxWidth={640}
        minWidth={320}
        onExpandChange={(next) => {
          if (!next) setSelectedDeviceId(undefined);
        }}
      >
        {selectedDevice && (
          <DeviceDetailPanel
            device={selectedDevice}
            isCurrent={selectedDevice.deviceId === currentDeviceId}
            key={selectedDevice.deviceId}
            onClose={() => setSelectedDeviceId(undefined)}
          />
        )}
      </RightPanel>
      {connectModal}
    </Flexbox>
  );
});

Page.displayName = 'DevicesSettings';

export default Page;
