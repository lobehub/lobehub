'use client';

import { memo } from 'react';

import AutoSaveHintBase from '@/components/Editor/AutoSaveHint';

import { usePageEditorStore } from '../store';

/**
 * AutoSaveHint - Save status indicator for page editor
 */
const AutoSaveHint = memo(() => {
  const saveStatus = usePageEditorStore((s) => s.saveStatus);
  const lastUpdatedTime = usePageEditorStore((s) => s.lastUpdatedTime);

  return (
    <AutoSaveHintBase
      lastUpdatedTime={lastUpdatedTime}
      saveStatus={saveStatus}
      style={{
        marginLeft: 6,
      }}
    />
  );
});

export default AutoSaveHint;
