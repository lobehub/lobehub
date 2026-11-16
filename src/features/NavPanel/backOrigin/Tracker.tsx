'use client';

import { useEffect, useState } from 'react';

import { useActiveLocation } from '@/hooks/useActiveLocation';

import { readHistoryIndex } from './historyIndex';
import { createBackOriginRecorder, pruneBackOwners } from './index';
import { useLocationOwner, useOpenOwnersKey } from './useLocationOwner';

/** Feeds every in-app navigation to the back-origin store. Renders nothing. */
const BackOriginTracker = () => {
  const { hash, pathname, search } = useActiveLocation();
  const owner = useLocationOwner();
  const openOwnersKey = useOpenOwnersKey();
  const [record] = useState(createBackOriginRecorder);

  useEffect(() => {
    if (openOwnersKey === null) return;
    pruneBackOwners(new Set(openOwnersKey.split('\n')));
  }, [openOwnersKey]);

  useEffect(() => {
    // Desktop tab urls carry no hash; on web it brings back a section anchor.
    record(owner, `${pathname}${search}${hash}`, readHistoryIndex());
  }, [owner, pathname, search, hash, record]);

  return null;
};

export default BackOriginTracker;
