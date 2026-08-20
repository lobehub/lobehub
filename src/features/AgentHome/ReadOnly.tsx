'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import AgentInfo from './AgentInfo';

/** Static welcome surface for viewers who cannot interact with the agent. */
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
