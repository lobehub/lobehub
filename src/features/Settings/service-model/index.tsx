'use client';

import { useTranslation } from 'react-i18next';

import { ServiceModelForm } from '@/features/ServiceModel';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import Image from '../image/features/Image';

interface PageProps {
  hidePersonalPreferences?: boolean;
  showSettingHeader?: boolean;
}

const Page = ({ hidePersonalPreferences, showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');
  const { showAiImage } = useServerConfigStore(featureFlagsSelectors);
  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.serviceModel')} />}
      <ServiceModelForm hidePersonalPreferences={hidePersonalPreferences} />
      {showAiImage && <Image />}
    </>
  );
};

export default Page;
