import { memo, useState } from 'react';

import Controls from '@/features/ChatInput/ActionBar/Params/Controls';
import { createStore, Provider } from '@/features/ChatInput/store';
import { useAgentStore } from '@/store/agent';

const ParamsSection = memo(() => {
  const agentId = useAgentStore((s) => s.activeAgentId) || '';
  const [updating, setUpdating] = useState(false);

  return (
    <Provider createStore={() => createStore({ agentId })} key={agentId}>
      <Controls setUpdating={setUpdating} updating={updating} variant="sidebar" />
    </Provider>
  );
});

ParamsSection.displayName = 'AgentWorkingSidebarParamsSection';

export default ParamsSection;
