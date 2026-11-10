'use client';

import { lazy, Suspense } from 'react';

import { useMeetingStore } from '@/store/meeting';

const MeetingRecorderOverlay = lazy(() => import('./Overlay'));

/**
 * Mount point of the floating recorder in the app layout. The overlay chunk
 * loads on first open; until then the layout only pays for this store read.
 */
const MeetingRecorderHost = () => {
  const open = useMeetingStore((s) => s.overlay.open);
  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <MeetingRecorderOverlay />
    </Suspense>
  );
};

export default MeetingRecorderHost;
