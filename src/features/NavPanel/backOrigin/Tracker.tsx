'use client';

import { useEffect, useState } from 'react';

import { useActiveLocation } from '@/hooks/useActiveLocation';

import { readHistoryIndex } from './historyIndex';
import { createBackOriginRecorder } from './index';
import { useLocationOwner } from './useLocationOwner';

/** Feeds every in-app navigation to the back-origin store. Renders nothing. */
const BackOriginTracker = () => {
  const { hash, pathname, search } = useActiveLocation();
  const owner = useLocationOwner();
  const [record] = useState(createBackOriginRecorder);

  useEffect(() => {
    // Desktop tab urls carry no hash; on web it brings back a section anchor.
    record(owner, `${pathname}${search}${hash}`, readHistoryIndex());
  }, [owner, pathname, search, hash, record]);

  return null;
};

export default BackOriginTracker;
