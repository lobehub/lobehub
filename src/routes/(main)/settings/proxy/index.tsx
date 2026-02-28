import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import ProxyForm from './features/ProxyForm';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.proxy')} />
      <ProxyForm />
    </>
  );
};

export default Page;
