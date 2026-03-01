import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import ApiKey from './features/ApiKey';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.apikey')} />
      <ApiKey />
    </>
  );
};

export default Page;
