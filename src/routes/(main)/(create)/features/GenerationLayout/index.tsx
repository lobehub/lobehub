'use client';

import { Flexbox } from '@lobehub/ui';
import type { FC, ReactNode } from 'react';
import { Outlet } from 'react-router-dom';

import Sidebar from './Sidebar';
import { styles } from './style';
import type { GenerationLayoutCommonProps } from './types';

export interface GenerationLayoutProps extends GenerationLayoutCommonProps {
  /** Optional extra content (e.g. RegisterHotkeys for image) */
  extra?: ReactNode;
}

const GenerationLayout: FC<GenerationLayoutProps> = ({ extra, ...commonProps }) => (
  <>
    <Sidebar {...commonProps} />
    <Flexbox className={styles.mainContainer} flex={1} height={'100%'}>
      <Outlet />
    </Flexbox>
    {extra}
  </>
);

export default GenerationLayout;
