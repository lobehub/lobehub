import Controls from '@/features/ChatInput/ActionBar/Params/Controls';
import { createStore, Provider } from '@/features/ChatInput/store';
import { useAgentStore } from '@/store/agent';

const ParamsSection = () => {
  const agentId = useAgentStore((s) => s.activeAgentId) || '';

  return (
    <Provider createStore={() => createStore({ agentId })} key={agentId}>
      <Controls variant="sidebar" />
    </Provider>
  );
};

export default ParamsSection;
