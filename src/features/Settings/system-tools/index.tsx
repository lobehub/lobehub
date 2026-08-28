import { useTranslation } from 'react-i18next';

import SettingHeader from '@/features/Settings/features/SettingHeader';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';

import AppEnvironmentSection from './features/AppEnvironmentSection';
import CliTestSection from './features/CliTestSection';
import ShellSection from './features/ShellSection';
import ToolDetectorSection from './features/ToolDetectorSection';

const Page = () => {
  const { t } = useTranslation('setting');
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  return (
    <>
      <SettingHeader title={t('tab.systemTools')} />
      <ShellSection />
      <ToolDetectorSection />
      <AppEnvironmentSection />
      {isDevMode ? <CliTestSection /> : null}
    </>
  );
};

export default Page;
