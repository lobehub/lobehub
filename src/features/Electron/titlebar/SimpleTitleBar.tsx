'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';

import { ProductLogo } from '@/components/Branding/ProductLogo';
import { electronStylish } from '@/styles/electron';

import { useWatchThemeUpdate } from '../system/useWatchThemeUpdate';

/**
 * A simple, minimal TitleBar for Electron windows.
 * Provides draggable area without business logic (navigation, updates, etc.)
 * Use this for secondary windows like onboarding, settings, etc.
 */
const SimpleTitleBar: FC = () => {
  useWatchThemeUpdate();
  return (
    <Flexbox
      horizontal
      align={'center'}
      className={electronStylish.draggable}
      height={TITLE_BAR_HEIGHT}
      justify={'center'}
      width={'100%'}
    >
      <ProductLogo size={16} type={'text'} />
    </Flexbox>
  );
};

export default SimpleTitleBar;
