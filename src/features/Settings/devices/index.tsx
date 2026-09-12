'use client';

import { Flexbox, Form, Icon } from '@lobehub/ui';
import { ActionIcon, Button, Tabs, Text } from '@lobehub/ui/base-ui';
import { MonitorUpIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { DeviceConnectModal, DeviceManager, useDeviceList } from '@/features/DeviceManager';
import { DevicePoolManager } from '@/features/DeviceManager/DevicePoolManager';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const Page = memo(() => {
  const { t } = useTranslation('setting');
  const [section, setSection] = useState('devices');
  const enableDevicePools = useUserStore(labPreferSelectors.enableDevicePools);
  const [open, setOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<'cli' | 'desktop'>();
  // Shares DeviceManager's SWR entry, so the header actions drive the list it
  // renders — the same wiring the workspace devices page uses.
  const { data, isValidating, mutate } = useDeviceList();

  const handleConnect = (tab?: 'cli' | 'desktop') => {
    setInitialTab(tab);
    setOpen(true);
  };

  const devices = (data ?? []).filter((device) => device.scope === 'personal');

  return (
    <>
      {enableDevicePools && (
        <Tabs
          activeKey={section}
          items={[
            { key: 'devices', label: t('devices.tabs.private') },
            { key: 'pools', label: t('devices.tabs.shared') },
          ]}
          onChange={setSection}
        />
      )}
      {!enableDevicePools || section === 'devices' ? (
        <Form
          collapsible={false}
          itemsType={'group'}
          variant={'filled'}
          items={[
            {
              children: <DeviceManager scope={'personal'} onConnect={handleConnect} />,
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
      ) : (
        <DevicePoolManager scope="personal" />
      )}

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
