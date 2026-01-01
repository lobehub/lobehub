'use client';

import { memo } from 'react';

import AutoSaveHintBase from '@/components/Editor/AutoSaveHint';

/**
 * AutoSaveHint - Save status indicator for group settings
 * TODO: Add saveStatus and lastUpdatedTime to agentGroupStore when needed
 */
const AutoSaveHint = memo(() => {
  // Group profile currently doesn't track save status
  // Return idle state for now
  return <AutoSaveHintBase lastUpdatedTime={null} saveStatus={'idle'} />;
});

export default AutoSaveHint;
