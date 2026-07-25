'use client';

import { Switch } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import { useDevDockStore } from '../store';

const ReactScanWidget = memo(() => {
  const reactScan = useDevDockStore((s) => s.reactScan);
  const setReactScan = useDevDockStore((s) => s.setReactScan);
  return (
    <label style={{ alignItems: 'center', cursor: 'pointer', display: 'inline-flex', gap: 5 }}>
      <Switch checked={reactScan} size={'small'} onChange={setReactScan} />
      <span>React Scan</span>
    </label>
  );
});

ReactScanWidget.displayName = 'DevDockReactScanWidget';

export default ReactScanWidget;
