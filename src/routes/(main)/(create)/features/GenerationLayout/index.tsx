'use client';

import { Flexbox } from '@lobehub/ui';
import type { FC, ReactNode } from 'react';
import { Outlet } from 'react-router';

import { styles } from './style';

export interface GenerationLayoutProps {
  /** Optional extra content (e.g. RegisterHotkeys for image) */
  extra?: ReactNode;
  /** Sidebar wrapped in a NavPanelPortal by the caller (namespace-specific). */
  sidebar: ReactNode;
}

const GenerationLayout: FC<GenerationLayoutProps> = ({ extra, sidebar }) => (
  <>
    {sidebar}
    <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
      <Outlet />
    </Flexbox>
    {extra}
  </>
);

export default GenerationLayout;
