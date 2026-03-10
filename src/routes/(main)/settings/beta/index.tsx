import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import UpdateChannel from './features/UpdateChannel';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.beta')} />
      <UpdateChannel />
    </>
  );
};

export default Page;
