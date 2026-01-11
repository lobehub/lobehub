'use client';

import { memo } from 'react';

import AutoSaveHintBase from '@/components/Editor/AutoSaveHint';
import { useAgentStore } from '@/store/agent';

/**
 * AutoSaveHint - Save status indicator for agent settings
 */
const AutoSaveHint = memo(() => {
  const saveStatus = useAgentStore((s) => s.saveStatus);
  const lastUpdatedTime = useAgentStore((s) => s.lastUpdatedTime);

  return <AutoSaveHintBase lastUpdatedTime={lastUpdatedTime} saveStatus={saveStatus || 'idle'} />;
});

export default AutoSaveHint;
