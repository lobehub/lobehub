'use client';

import { Flexbox } from '@lobehub/ui';

import { EnvironmentManagerSkeleton } from '@/features/EnvironmentManager/Skeleton';

import type { SettingsTabSkeleton } from './types';

const Body = () => (
  <Flexbox style={{ maxWidth: 1024, width: '100%' }}>
    <EnvironmentManagerSkeleton />
  </Flexbox>
);

const EnvironmentsSkeleton: SettingsTabSkeleton = { Body };

export default EnvironmentsSkeleton;
