import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';

import ToolDetectorSection from './features/ToolDetectorSection';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.systemTools')} />
      <ToolDetectorSection />
    </>
  );
};

export default Page;
