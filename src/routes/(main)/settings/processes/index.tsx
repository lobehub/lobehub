import { useTranslation } from 'react-i18next';

import ProcessManagerPanel from '@/features/ProcessManager';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

const Page = () => {
  const { t } = useTranslation('setting');

  return (
    <>
      <SettingHeader title={t('tab.processes')} />
      <ProcessManagerPanel />
    </>
  );
};

export default Page;
