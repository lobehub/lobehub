'use client';

import { useTranslation } from 'react-i18next';

import GenerationLayout from '@/routes/(main)/(create)/features/GenerationLayout';
import { useVideoStore } from '@/store/video';
import { generationTopicSelectors } from '@/store/video/slices/generationTopic/selectors';

const VideoLayout = () => {
  const { t } = useTranslation(['common']);

  return (
    <GenerationLayout
      breadcrumb={[{ href: '/video', title: t('tab.video') }]}
      generationTopicsSelector={generationTopicSelectors.generationTopics}
      namespace="video"
      navKey="video"
      useStore={useVideoStore}
      viewModeStatusKey="videoTopicViewMode"
    />
  );
};

export default VideoLayout;
