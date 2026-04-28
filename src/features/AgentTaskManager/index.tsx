import { memo } from 'react';

import RightPanel from '@/features/RightPanel';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Conversation from './Conversation';

const AgentTaskManager = memo(() => {
  const [expand, toggleTaskAgentPanel] = useGlobalStore((s) => [
    systemStatusSelectors.showTaskAgentPanel(s),
    s.toggleTaskAgentPanel,
  ]);

  return (
    <RightPanel
      defaultWidth={420}
      expand={expand}
      maxWidth={720}
      minWidth={320}
      onExpandChange={(next) => toggleTaskAgentPanel(next)}
    >
      <Conversation />
    </RightPanel>
  );
});

AgentTaskManager.displayName = 'AgentTaskManager';

export default AgentTaskManager;
