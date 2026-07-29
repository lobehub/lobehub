import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import Conversation from './features/Conversation';
import Desktop from './features/Desktop';
import Essential from './features/Essential';

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
    </>
  );
};

export default Page;
