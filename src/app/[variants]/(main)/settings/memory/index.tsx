import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';

import Memory from './features/Memory';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.memory')} />
      <Memory />
    </>
  );
};

Page.displayName = 'MemorySetting';

export default Page;
