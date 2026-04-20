'use client';

import { useTranslation } from 'react-i18next';

import GenerationLayout from '@/routes/(main)/(create)/features/GenerationLayout';
import { useImageStore } from '@/store/image';
import { generationTopicSelectors } from '@/store/image/slices/generationTopic/selectors';

import RegisterHotkeys from './RegisterHotkeys';

const ImageLayout = () => {
  const { t } = useTranslation(['common']);

  return (
    <GenerationLayout
      breadcrumb={[{ href: '/image', title: t('tab.image') }]}
      extra={<RegisterHotkeys />}
      generationTopicsSelector={generationTopicSelectors.generationTopics}
      namespace="image"
      navKey="image"
      useStore={useImageStore}
      viewModeStatusKey="imageTopicViewMode"
    />
  );
};

export default ImageLayout;
