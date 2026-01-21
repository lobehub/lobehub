import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import { isDesktop } from '@/const/version';

import Conversation from './features/Conversation';
import Desktop from './features/Desktop';
import Essential from './features/Essential';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.hotkey')} />
      {isDesktop && <Desktop />}
      <Essential />
      <Conversation />
    </>
  );
};

export default Page;
