import { memo } from 'react';

import RightPanel from '@/features/RightPanel';

import Conversation from './Conversation';

const AgentTaskManager = memo(() => {
  return (
    <RightPanel defaultWidth={420} maxWidth={720} minWidth={320}>
      <Conversation />
    </RightPanel>
  );
});

AgentTaskManager.displayName = 'AgentTaskManager';

export default AgentTaskManager;
