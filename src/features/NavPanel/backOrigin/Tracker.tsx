'use client';

import { useEffect, useRef } from 'react';

import { useActiveLocation } from '@/hooks/useActiveLocation';

import { recordBackOrigin } from './index';

/** Feeds every in-app navigation to {@link recordBackOrigin}. Renders nothing. */
const BackOriginTracker = () => {
  const { pathname, search } = useActiveLocation();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const current = `${pathname}${search}`;
    if (previous.current === current) return;

    recordBackOrigin(previous.current, current);
    previous.current = current;
  }, [pathname, search]);

  return null;
};

export default BackOriginTracker;
