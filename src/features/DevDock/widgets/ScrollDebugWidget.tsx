'use client';

import { Switch } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import { useDevDockStore } from '../store';

const ScrollDebugWidget = memo(() => {
  const scrollDebug = useDevDockStore((s) => s.scrollDebug);
  const setScrollDebug = useDevDockStore((s) => s.setScrollDebug);
  return (
    <label style={{ alignItems: 'center', cursor: 'pointer', display: 'inline-flex', gap: 5 }}>
      <Switch checked={scrollDebug} size={'small'} onChange={setScrollDebug} />
      <span>Scroll debug</span>
    </label>
  );
});

ScrollDebugWidget.displayName = 'DevDockScrollDebugWidget';

export default ScrollDebugWidget;
