import { useTranslation } from 'react-i18next';

import SettingHeader from '@/features/Settings/features/SettingHeader';

import AppEnvironmentSection from './features/AppEnvironmentSection';
import CliTestSection from './features/CliTestSection';
import ShellSection from './features/ShellSection';
import ToolDetectorSection from './features/ToolDetectorSection';

const Page = ({ showSettingHeader = true }: { showSettingHeader?: boolean }) => {
  const { t } = useTranslation('setting');
  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.systemTools')} />}
      <ShellSection />
      <ToolDetectorSection />
      <AppEnvironmentSection />
      {/* Internal check of the embedded CLI; untranslated, so dev builds only. */}
      {__DEV__ ? <CliTestSection /> : null}
    </>
  );
};

export default Page;
