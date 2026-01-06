'use client';

import { useEffect, useState } from 'react';

/**
 * Returns true after the component is mounted on the client.
 */
export const useMounted = (): boolean => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
};
