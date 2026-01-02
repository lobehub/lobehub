import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';

import Image from './features/Image';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.image')} />
      <Image />
    </>
  );
};

Page.displayName = 'ImageSetting';

export default Page;
