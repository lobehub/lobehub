'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import Body from '@/routes/(main)/(create)/features/GenerationLayout/Body';
import Header from '@/routes/(main)/(create)/features/GenerationLayout/Header';
import type { GenerationLayoutCommonProps } from '@/routes/(main)/(create)/features/GenerationLayout/types';
import { useVideoStore } from '@/store/video';
import { generationTopicSelectors } from '@/store/video/slices/generationTopic/selectors';

const useVideoSidebarProps = (): GenerationLayoutCommonProps => {
  const { t } = useTranslation('common');
  return {
    breadcrumb: [{ href: '/video', title: t('tab.video') }],
    generationTopicsSelector: generationTopicSelectors.generationTopics,
    namespace: 'video',
    navKey: 'image',
    useStore: useVideoStore,
    viewModeStatusKey: 'videoTopicViewMode',
  };
};

const VideoSidebarContent = memo(() => {
  const props = useVideoSidebarProps();
  return <SideBarLayout body={<Body {...props} />} header={<Header {...props} />} />;
});

VideoSidebarContent.displayName = 'VideoSidebarContent';

export default VideoSidebarContent;
