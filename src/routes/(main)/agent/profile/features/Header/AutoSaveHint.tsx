'use client';

import { memo, useEffect } from 'react';

import AutoSaveHintBase from '@/components/Editor/AutoSaveHint';
import { useAgentStore } from '@/store/agent';

const SAVED_STATUS_DURATION = 2000;

/**
 * AutoSaveHint - Save status indicator for agent settings
 */
const AutoSaveHint = memo(() => {
  const saveStatus = useAgentStore((s) => s.saveStatus);
  const retryAgentSave = useAgentStore((s) => s.retryAgentSave);
  const updateSaveStatus = useAgentStore((s) => s.updateSaveStatus);

  useEffect(() => {
    if (saveStatus !== 'saved') return;

    const timer = setTimeout(() => updateSaveStatus('idle'), SAVED_STATUS_DURATION);

    return () => clearTimeout(timer);
  }, [saveStatus, updateSaveStatus]);

  if (saveStatus === 'idle') return null;

  return <AutoSaveHintBase saveStatus={saveStatus} onRetry={retryAgentSave} />;
});

export default AutoSaveHint;
