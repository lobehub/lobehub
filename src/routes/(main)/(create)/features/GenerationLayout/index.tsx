'use client';

import { Flexbox } from '@lobehub/ui';
import type { FC, ReactNode } from 'react';
import { Outlet } from 'react-router';

import { TopicUrlSync, type TopicUrlSyncStore } from '@/features/Generation';

import { styles } from './style';

export interface GenerationLayoutProps {
  /** Optional extra content (e.g. RegisterHotkeys for image) */
  extra?: ReactNode;
  /** Sidebar wrapped in a NavPanelPortal by the caller (namespace-specific). */
  sidebar: ReactNode;
  /**
   * Namespace store driving the URL ⇄ activeGenerationTopicId sync. The sync
   * lives here rather than in the sidebar because on Electron the sidebar is
   * portal'd into the shell, which is bound to the frozen root router.
   */
  useStore: TopicUrlSyncStore;
}

const GenerationLayout: FC<GenerationLayoutProps> = ({ extra, sidebar, useStore }) => (
  <>
    {sidebar}
    <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
      <Outlet />
    </Flexbox>
    <TopicUrlSync useStore={useStore} />
    {extra}
  </>
);

export default GenerationLayout;
