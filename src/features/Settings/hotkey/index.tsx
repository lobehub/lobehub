import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import SettingHeader from '@/features/Settings/features/SettingHeader';

import AppMenu from './features/AppMenu';
import Conversation from './features/Conversation';
import Desktop from './features/Desktop';
import Essential from './features/Essential';
import Mail from './features/Mail';

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');
  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.hotkey')} />}
      {isDesktop && <Desktop />}
      <Essential />
      <Conversation />
      <Mail />
      {isDesktop && <AppMenu />}
    </>
  );
};

export default Page;
