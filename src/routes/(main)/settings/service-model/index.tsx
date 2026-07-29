'use client';

import { useTranslation } from 'react-i18next';

import { ModelAssignmentsForm } from '@/features/ServiceModel';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import Image from '../image/features/Image';
import OpenAI from '../tts/features/OpenAI';

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');
  const { enableSTT, showAiImage } = useServerConfigStore(featureFlagsSelectors);
  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.serviceModel')} />}
      <ModelAssignmentsForm />
      {enableSTT && <OpenAI />}
      {showAiImage && <Image />}
    </>
  );
};

export default Page;
