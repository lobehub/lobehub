'use client';

import { useEffect, useState } from 'react';

import { useSearchParams } from '@/libs/router/navigation';

/**
 * Hook to check if the current page is in single mode
 * Single mode is used for standalone windows in desktop app
 * React Router version for SPA
 * @returns boolean indicating if the current page is in single mode
 */
export const useIsSingleMode = (): boolean => {
  const [isSingleMode, setIsSingleMode] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (mounted) {
      setIsSingleMode(searchParams.get('mode') === 'single');
    }
  }, [searchParams, mounted]);

  // Return false during SSR or before hydration
  return mounted ? isSingleMode : false;
};