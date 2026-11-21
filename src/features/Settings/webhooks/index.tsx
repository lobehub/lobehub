import { useTranslation } from 'react-i18next';

import SettingHeader from '@/features/Settings/features/SettingHeader';
import Webhooks from '@/features/Webhooks';

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');

  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.webhooks')} />}
      <Webhooks />
    </>
  );
};

export default Page;
