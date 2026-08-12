import type { AgentStore } from '../../store';

const generationByAgentId = (agentId: string) => (state: AgentStore) =>
  state.agentArtworkGenerationMap[agentId];

export const agentArtworkSelectors = {
  generationByAgentId,
};
