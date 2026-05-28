'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import DeviceList from './features/DeviceList';

const Page = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <>
      <SettingHeader title={t('devices.title')} />
      <DeviceList />
    </>
  );
});

Page.displayName = 'DevicesSettings';

export default Page;
