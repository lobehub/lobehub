'use client';

import { Button, Icon } from '@lobehub/ui';
import { MonitorUpIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import ConnectDeviceModal from './features/ConnectDeviceModal';
import DeviceList from './features/DeviceList';

const Page = memo(() => {
  const { t } = useTranslation('setting');
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  return (
    <>
      <SettingHeader
        title={t('devices.title')}
        extra={
          <Button
            icon={<Icon icon={MonitorUpIcon} />}
            size={'small'}
            onClick={() => setConnectModalOpen(true)}
          >
            {t('devices.connectWizard.button')}
          </Button>
        }
      />

      <DeviceList />

      <ConnectDeviceModal open={connectModalOpen} onClose={() => setConnectModalOpen(false)} />
    </>
  );
});

Page.displayName = 'DevicesSettings';

export default Page;
