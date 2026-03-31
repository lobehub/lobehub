'use client';

import { memo } from 'react';

import RightPanel from '@/features/RightPanel';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Conversation from './Conversation';

/**
 * Help write, read, and edit the page
 */
const Copilot = memo(() => {
  const [width, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.pageAgentPanelWidth(s),
    s.updateSystemStatus,
  ]);

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
      <Conversation />
    </RightPanel>
  );
});

export default Copilot;
