'use client';

import { memo } from 'react';

import RightPanel from '@/features/RightPanel';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

import Conversation from './Conversation';

/**
 * Help write, read, and edit the page
 */
const Copilot = memo(() => {
  const pageAgentId = useAgentStore(builtinAgentSelectors.pageAgentId);

  return (
    <RightPanel>
      <Conversation agentId={pageAgentId} />
    </RightPanel>
  );
});

export default Copilot;
