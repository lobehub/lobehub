'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import Body from '@/routes/(main)/(create)/features/GenerationLayout/Body';
import Header from '@/routes/(main)/(create)/features/GenerationLayout/Header';
import type { GenerationLayoutCommonProps } from '@/routes/(main)/(create)/features/GenerationLayout/types';
import { useImageStore } from '@/store/image';
import { generationTopicSelectors } from '@/store/image/slices/generationTopic/selectors';

const useImageSidebarProps = (): GenerationLayoutCommonProps => {
  const { t } = useTranslation('common');
  return {
    breadcrumb: [{ href: '/image', title: t('tab.image') }],
    generationTopicsSelector: generationTopicSelectors.generationTopics,
    namespace: 'image',
    navKey: 'image',
    useStore: useImageStore,
    viewModeStatusKey: 'imageTopicViewMode',
  };
};

const ImageSidebarContent = memo(() => {
  const props = useImageSidebarProps();
  return <SideBarLayout body={<Body {...props} />} header={<Header {...props} />} />;
});

ImageSidebarContent.displayName = 'ImageSidebarContent';

export default ImageSidebarContent;
