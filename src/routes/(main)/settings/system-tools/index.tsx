import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import AppEnvironmentSection from './features/AppEnvironmentSection';
import CliTestSection from './features/CliTestSection';
import ToolDetectorSection from './features/ToolDetectorSection';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.systemTools')} />
      <AppEnvironmentSection />
      <ToolDetectorSection />
      <CliTestSection />
    </>
  );
};

export default Page;
