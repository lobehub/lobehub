'use client';

import { lazy, memo,Suspense } from 'react';

// Lazy load the CommandMenu component with React lazy
// This splits the CommandMenu code into a separate chunk that only loads when needed
const CmdkComponent = lazy(() => import('@/features/CommandMenu'));

const CmdkLazy = memo(() => (
  <Suspense fallback={null}>
    <CmdkComponent />
  </Suspense>
));

CmdkLazy.displayName = 'CmdkLazy';

export default CmdkLazy;
