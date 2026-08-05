import { useTranslation } from 'react-i18next';

import MessengerSettings from '@/features/Messenger';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');
  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.messenger')} />}
      <MessengerSettings />
    </>
  );
};

export default Page;
