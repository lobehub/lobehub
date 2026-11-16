'use client';

import { useEffect, useState } from 'react';

import { useActiveLocation } from '@/hooks/useActiveLocation';

import { createBackOriginRecorder } from './index';
import { useLocationOwner } from './useLocationOwner';

/** Feeds every in-app navigation to the back-origin store. Renders nothing. */
const BackOriginTracker = () => {
  const { pathname, search } = useActiveLocation();
  const owner = useLocationOwner();
  const [record] = useState(createBackOriginRecorder);

  useEffect(() => {
    record(owner, `${pathname}${search}`);
  }, [owner, pathname, search, record]);

  return null;
};

export default BackOriginTracker;
