'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AgentInfo from './AgentInfo';

/**
 * Welcome surface for viewers who do not own the agent (e.g. the agent-share
 * visitor page): agent identity only, without the owner-scoped opening
 * questions and tool-authorization alert that `AgentHome` renders.
 */
const ReadOnlyAgentHome = memo(() => (
  <>
    <Flexbox flex={1} />
    <Flexbox gap={32} style={{ paddingBottom: 'max(4vh, 16px)' }} width={'100%'}>
      <AgentInfo />
    </Flexbox>
  </>
));

ReadOnlyAgentHome.displayName = 'ReadOnlyAgentHome';

export default ReadOnlyAgentHome;
