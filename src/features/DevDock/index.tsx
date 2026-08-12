'use client';

import { registerBusinessDevDockItems } from '@/business/client/registerDevDockItems';
import FlagOverrideHydrator from '@/features/DevFeatureFlagPanel/Hydrator';

import Bar from './Bar';
import PanelHost from './PanelHost';
import ReactScanController from './ReactScanController';
import { registerBuiltinDevDockItems } from './registerBuiltinItems';

registerBuiltinDevDockItems();
registerBusinessDevDockItems();

const DevDock = () => {
  return (
    <>
      <FlagOverrideHydrator />
      <ReactScanController />
      <PanelHost />
      <Bar />
    </>
  );
};

export default DevDock;
