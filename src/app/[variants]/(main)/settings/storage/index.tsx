import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';

import Advanced from './features/Advanced';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.storage')} />
      <Advanced />
    </>
  );
};

Page.displayName = 'StorageSetting';

export default Page;
