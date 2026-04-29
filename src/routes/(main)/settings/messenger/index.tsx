import { useTranslation } from 'react-i18next';

import LobeAIMessengerSettings from '@/features/LobeAIMessenger';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.messenger')} />
      <LobeAIMessengerSettings />
    </>
  );
};

export default Page;
