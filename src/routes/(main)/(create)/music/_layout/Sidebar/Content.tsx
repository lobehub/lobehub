'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import Body from '@/routes/(main)/(create)/features/GenerationLayout/Body';
import Header from '@/routes/(main)/(create)/features/GenerationLayout/Header';
import type { GenerationLayoutCommonProps } from '@/routes/(main)/(create)/features/GenerationLayout/types';
import { useMusicStore } from '@/store/music';
import { generationTopicSelectors } from '@/store/music/slices/generationTopic/selectors';

const useMusicSidebarProps = (): GenerationLayoutCommonProps => {
  const { t } = useTranslation('common');
  return {
    breadcrumb: [{ href: '/music', title: t('tab.music') }],
    generationTopicsSelector: generationTopicSelectors.generationTopics,
    namespace: 'music',
    navKey: 'music',
    useStore: useMusicStore,
    viewModeStatusKey: 'musicTopicViewMode',
  };
};

const MusicSidebarContent = memo(() => {
  const props = useMusicSidebarProps();
  return <SideBarLayout body={<Body {...props} />} header={<Header {...props} />} />;
});

MusicSidebarContent.displayName = 'MusicSidebarContent';

export default MusicSidebarContent;
