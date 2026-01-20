import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';

import ChatAppearance from './features/ChatAppearance';

const Page = () => {
  const { t } = useTranslation('setting');

  return (
    <>
      <SettingHeader title={t('tab.chatAppearance')} />
      <ChatAppearance />
    </>
  );
};

export default Page;
