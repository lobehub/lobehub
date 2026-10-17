'use client';

import { Flexbox } from '@lobehub/ui';
import type { ReactNode } from 'react';

import NavHeader from '@/features/NavHeader';

import LabOff from './LabOff';
import { useSelfLearningSurface } from './useSelfLearningSurface';

export { default as SelfLearningLabOff } from './LabOff';
export { useSelfLearningSurface } from './useSelfLearningSurface';

/**
 * Route-level gate for the Self-evolving pages, matching My rules: a deep link opens the page
 * only when the review surfaces are on, and otherwise lands on the "turn on in Labs" state.
 */
const SelfLearningSurfaceGate = ({ children }: { children: ReactNode }) => {
  const { enabled, ready } = useSelfLearningSurface();

  if (enabled) return children;
  // The Labs preference arrives with the user state; wait for it instead of flashing Labs.
  if (!ready) return null;

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader />
      <LabOff />
    </Flexbox>
  );
};

export default SelfLearningSurfaceGate;
