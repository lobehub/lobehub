'use client';

import { memo } from 'react';

import { registerBusinessDevDockItems } from '@/business/client/registerDevDockItems';
import FlagOverrideHydrator from '@/features/DevFeatureFlagPanel/Hydrator';

import Bar from './Bar';
import PanelHost from './PanelHost';
import ReactScanController from './ReactScanController';
import { registerBuiltinDevDockItems } from './registerBuiltinItems';

registerBuiltinDevDockItems();
registerBusinessDevDockItems();

const DevDock = memo(() => {
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
