'use client';

import { lazy, memo, Suspense, useEffect, useState } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';

import Fab from './Fab';
import Hydrator from './Hydrator';

const Panel = lazy(() => import('./Panel'));

const isDevEnv = process.env.NODE_ENV === 'development';
const STORAGE_KEY = 'LOBE_DEV_FEATURE_FLAG_PANEL_ENABLED';

const useDevPanelEnabled = (): boolean => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!isDevEnv) return;
    setEnabled(window.localStorage.getItem(STORAGE_KEY) === '1');

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setEnabled(e.newValue === '1');
    };
    window.addEventListener('storage', onStorage);

    if (!window.localStorage.getItem(STORAGE_KEY)) {
      console.info(
        `[DevFeatureFlagPanel] Dev tool available. Enable with: localStorage.${STORAGE_KEY} = "1"`,
      );
    }

    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return enabled;
};

const DevFeatureFlagPanel = memo(() => {
  const enabled = useDevPanelEnabled();
  const [open, setOpen] = useState(false);
  const originalFlags = useServerConfigStore((s) => s._originalFeatureFlags);

  if (!isDevEnv || !enabled) return null;

  return (
    <>
      <Hydrator />
      {originalFlags && <Fab active={open} onToggle={() => setOpen((v) => !v)} />}
      {open && (
        <Suspense fallback={null}>
          <Panel onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
});

DevFeatureFlagPanel.displayName = 'DevFeatureFlagPanel';

export default DevFeatureFlagPanel;
