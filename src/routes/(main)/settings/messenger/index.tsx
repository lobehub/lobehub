import { useTranslation } from 'react-i18next';

import MessengerSettings from '@/features/Messenger';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.messenger')} />
      <MessengerSettings />
    </>
  );
};

export default Page;
