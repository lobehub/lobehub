import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import OAuthApps from './features/OAuthApps';

const Page = () => {
  const { t } = useTranslation('auth');
  return (
    <>
      <SettingHeader title={t('tab.oauthApps')} />
      <OAuthApps />
    </>
  );
};

export default Page;
