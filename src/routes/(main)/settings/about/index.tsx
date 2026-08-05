import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import About from './features/About';
import Analytics from './features/Analytics';

interface PageProps {
  mobile?: boolean;
  showSettingHeader?: boolean;
}

const Page = ({ mobile, showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');
  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.about')} />}
      <About mobile={mobile} />
      <Analytics />
    </>
  );
};

export default Page;
