'use client';

import { memo } from 'react';

import RightPanel from '@/features/RightPanel';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Conversation from './Conversation';

/**
 * Help write, read, and edit the page
 */
const Copilot = memo(() => {
  const pageAgentId = useAgentStore(builtinAgentSelectors.pageAgentId);
  const [width, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.pageAgentPanelWidth(s),
    s.updateSystemStatus,
  ]);

  console.log('defaultWidth:', width);
  return (
    <RightPanel
      defaultWidth={width}
      onSizeChange={(size) => {
        if (size?.width) {
          const w = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
          if (!!w) updateSystemStatus({ pageAgentPanelWidth: w });
        }
      }}
    >
      <Conversation agentId={pageAgentId} />
    </RightPanel>
  );
});

export default Copilot;
