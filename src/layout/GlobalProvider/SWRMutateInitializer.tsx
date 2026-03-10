'use client';

import { type PropsWithChildren, useEffect } from 'react';
import { useSWRConfig } from 'swr';

import { setScopedMutate } from '@/libs/swr';

/**
 * Initialize scoped mutate for use outside React components (e.g., Zustand stores)
 * This component must be rendered inside SWRConfig to access the scoped mutate
 */
const SWRMutateInitializer = ({ children }: PropsWithChildren) => {
  const { mutate } = useSWRConfig();

  useEffect(() => {
    setScopedMutate(mutate);
  }, [mutate]);

  return <>{children}</>;
};

export default SWRMutateInitializer;
