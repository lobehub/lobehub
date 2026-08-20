'use client';

import { Popover } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';

import AgentSharePopoverContent from './Content';

interface AgentSharePopoverProps {
  agentId?: string;
  children?: ReactNode;
}

/**
 * Creator-side share entry for one agent (LOBE-11935): a light popover for the
 * high-frequency actions (visibility + copy link) with a "Share Settings"
 * modal for the heavier permission / tool / limit configuration. The agent
 * profile page is desktop-only, so no mobile layout is needed here.
 */
const AgentSharePopover = memo<AgentSharePopoverProps>(({ agentId, children }) => {
  return (
    <Popover
      arrow={false}
      content={<AgentSharePopoverContent agentId={agentId} />}
      placement={'bottomRight'}
      trigger={['click']}
      styles={{
        content: {
          padding: 0,
          width: 366,
        },
      }}
    >
      {children}
    </Popover>
  );
});

AgentSharePopover.displayName = 'AgentSharePopover';

export default AgentSharePopover;
