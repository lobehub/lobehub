import { useAgentStore } from '@/store/agent';

export const useFetchAgentDocuments = (agentId?: string | null) => {
  const useFetchAgentDocuments = useAgentStore((s) => s.useFetchAgentDocuments);

  useFetchAgentDocuments(agentId);
};
