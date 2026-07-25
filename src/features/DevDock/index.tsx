'use client';

import { memo } from 'react';

import FlagOverrideHydrator from '@/features/DevFeatureFlagPanel/Hydrator';

import Bar from './Bar';
import PanelHost from './PanelHost';
import ReactScanController from './ReactScanController';
import { registerBuiltinDevDockItems } from './registerBuiltinItems';

registerBuiltinDevDockItems();

const DevDock = memo(() => {
  if (!__DEV__) return null;
  return (
    <>
      <FlagOverrideHydrator />
      <ReactScanController />
      <PanelHost />
      <Bar />
    </>
  );
});

DevDock.displayName = 'DevDock';

export default DevDock;
