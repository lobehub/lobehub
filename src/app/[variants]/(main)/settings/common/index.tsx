import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';

import Appearance from './features/Appearance';
import Common from './features/Common/Common';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.common')} />
      <Common />
      <Appearance />
    </>
  );
};

export default Page;
