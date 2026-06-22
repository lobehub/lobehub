'use client';

import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DeviceConnectModal, DeviceManager } from '@/features/DeviceManager';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

const WorkspaceDevicesSetting = memo(() => {
  const { t } = useTranslation('setting');
  const [open, setOpen] = useState(false);

  return (
    <>
      <SettingHeader title={t('tab.devices')} />

      <DeviceManager scope={'workspace'} onConnect={() => setOpen(true)} />

      <DeviceConnectModal open={open} scope={'workspace'} onClose={() => setOpen(false)} />
    </>
  );
});

WorkspaceDevicesSetting.displayName = 'WorkspaceDevicesSetting';

export default WorkspaceDevicesSetting;
