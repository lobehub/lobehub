'use client';

import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import FleetView from '@/features/Fleet';

const FleetPage = memo(() => {
  return (
    <Suspense fallback={<Loading debugId="FleetPage" />}>
      <FleetView />
    </Suspense>
  );
});

FleetPage.displayName = 'FleetPage';

export default FleetPage;
