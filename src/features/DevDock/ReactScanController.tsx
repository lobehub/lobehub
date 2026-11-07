'use client';

import { memo, useEffect } from 'react';

import { useDevDockStore } from './store';

// REACT_SCAN=true boots scanning from initialize.ts before this mounts, so it
// must count as touched — otherwise the dock toggle could never turn it off.
let touched = typeof __REACT_SCAN__ !== 'undefined' && __REACT_SCAN__;

const ReactScanController = memo(() => {
  const enabled = useDevDockStore((s) => s.reactScan);

  useEffect(() => {
    if (!enabled && !touched) return;
    touched = true;
    let cancelled = false;
    void import('react-scan').then(({ scan }) => {
      if (cancelled) return;
      scan({ enabled, showToolbar: enabled });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return null;
});

ReactScanController.displayName = 'DevDockReactScanController';

export default ReactScanController;
