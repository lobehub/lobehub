import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import CredentialsManagerPanel from './features/CredentialsManagerPanel';

const Page = () => {
  const { t } = useTranslation('setting');

  return (
    <>
      <SettingHeader title={t('tab.credentials')} />
      <CredentialsManagerPanel />
    </>
  );
};

Page.displayName = 'CredentialsSettings';

export default Page;
