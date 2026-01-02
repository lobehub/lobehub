'use client';

import { memo } from 'react';

import AutoSaveHintBase from '@/components/Editor/AutoSaveHint';

import { useDocumentEditorStore } from './store';

const AutoSaveHint = memo(() => {
  const saveStatus = useDocumentEditorStore((s) => s.saveStatus);
  const lastUpdatedTime = useDocumentEditorStore((s) => s.lastUpdatedTime);

  return <AutoSaveHintBase lastUpdatedTime={lastUpdatedTime} saveStatus={saveStatus} />;
});

export default AutoSaveHint;
