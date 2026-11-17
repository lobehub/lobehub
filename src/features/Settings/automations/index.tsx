import { useTranslation } from 'react-i18next';

import Automations from '@/features/Automations';
import SettingHeader from '@/features/Settings/features/SettingHeader';

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');

  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.automations')} />}
      <Automations />
    </>
  );
};

export default Page;
