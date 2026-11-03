import { useAgentStore } from '@/store/agent';

export const useFetchAvailableAgents = (enabled: boolean) => {
  const useFetchAvailableAgents = useAgentStore((s) => s.useFetchAvailableAgents);

  useFetchAvailableAgents(enabled);
};
