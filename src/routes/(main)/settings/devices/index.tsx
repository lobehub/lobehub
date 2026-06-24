'use client';

import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DeviceConnectModal, DeviceManager } from '@/features/DeviceManager';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

const Page = memo(() => {
  const { t } = useTranslation('setting');
  const [open, setOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<'cli' | 'desktop'>();

  const handleConnect = (tab?: 'cli' | 'desktop') => {
    setInitialTab(tab);
    setOpen(true);
  };

  return (
    <>
      <SettingHeader title={t('devices.title')} />

      <DeviceManager scope={'personal'} onConnect={handleConnect} />

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
