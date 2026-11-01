'use client';

import { useEffect } from 'react';
import { useSWRConfig } from 'swr';

/**
 * Preserve the shared imperative mutate contract without mounting Main SPA's
 * persisted query/cache provider in the Workbench shell.
 */
const SWRMutateInitializer = () => {
  const { mutate } = useSWRConfig();

  useEffect(() => {
    let active = true;

    void import('@/libs/swr').then(({ setScopedMutate }) => {
      if (active) setScopedMutate(mutate);
    });

    return () => {
      active = false;
    };
  }, [mutate]);

  return null;
};

export default SWRMutateInitializer;
