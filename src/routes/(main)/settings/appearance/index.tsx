import { useTranslation } from 'react-i18next';

import Terminal from '@/features/Settings/Appearance/Terminal';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import ChatAppearance from '../chat-appearance/features/ChatAppearance';
import Appearance from '../common/features/Appearance';
import Common from '../common/features/Common/Common';
import Desktop from './features/Desktop';

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');
  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.appearance')} />}
      <Common />
      <Appearance />
      <Desktop />
      <Terminal />
      <ChatAppearance />
    </>
  );
};

export default Page;
