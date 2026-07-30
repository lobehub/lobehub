'use client';

import { Flexbox } from '@lobehub/ui';

import { PlatformAdminPanel } from '@/features/PlatformAdmin';

const PlatformAdminPage = () => (
  <Flexbox padding={24} style={{ maxWidth: 1100, width: '100%' }}>
    <PlatformAdminPanel />
  </Flexbox>
);

export default PlatformAdminPage;
