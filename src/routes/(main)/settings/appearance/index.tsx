import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import Appearance from '../common/features/Appearance';
import Common from '../common/features/Common/Common';
import ChatAppearance from '../chat-appearance/features/ChatAppearance';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.appearance')} />
      <Common />
      <Appearance />
      <ChatAppearance />
    </>
  );
};

export default Page;
