import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';

import About from './features/About';
import Analytics from './features/Analytics';

const Page = ({ mobile }: { mobile?: boolean }) => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.about')} />
      <About mobile={mobile} />
      <Analytics />
    </>
  );
};

export default Page;
