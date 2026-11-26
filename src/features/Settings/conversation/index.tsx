import { useTranslation } from 'react-i18next';

import { ChatAssistForm } from '@/features/ServiceModel';
import SettingHeader from '@/features/Settings/features/SettingHeader';

import Display from './features/Display';
import Reply from './features/Reply';
import Sending from './features/Sending';
import Themes from './features/Themes';

interface PageProps {
  showSettingHeader?: boolean;
}

/**
 * How the user works with Agents in a conversation: replies, chat assist,
 * input and sending, and message display. User-scoped, so the workspace
 * settings mirror the same page.
 */
const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');
  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.conversation')} />}
      <Reply />
      <ChatAssistForm />
      <Sending />
      <Display />
      <Themes />
    </>
  );
};

export default Page;
