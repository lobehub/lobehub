'use client';

import { useEffect, useRef, useState } from 'react';

import { useActiveLocation } from '@/hooks/useActiveLocation';

import { readHistoryIndex } from './historyIndex';
import { closedOwnersBetween, createBackOriginRecorder, pruneBackOwners } from './index';
import { parseOpenOwners, useLocationOwner, useOpenOwnersKey } from './useLocationOwner';

/** Feeds every in-app navigation to the back-origin store. Renders nothing. */
const BackOriginTracker = () => {
  const { hash, key, pathname, search } = useActiveLocation();
  const owner = useLocationOwner();
  const openOwnersKey = useOpenOwnersKey();
  const [record] = useState(createBackOriginRecorder);

  const openOwnersKeyRef = useRef(openOwnersKey);

  useEffect(() => {
    const previous = parseOpenOwners(openOwnersKeyRef.current);
    pruneBackOwners(closedOwnersBetween(previous, parseOpenOwners(openOwnersKey)));
    openOwnersKeyRef.current = openOwnersKey;
  }, [openOwnersKey]);

  useEffect(() => {
    // Desktop tab urls carry no hash; on web it brings back a section anchor.
    record(owner, `${pathname}${search}${hash}`, readHistoryIndex());
    // `key` changes when the same url is pushed or popped again (a new history
    // entry with a new index).
  }, [owner, pathname, search, hash, key, record]);

  return null;
};

export default BackOriginTracker;
