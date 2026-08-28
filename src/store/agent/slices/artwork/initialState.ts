import type { AgentArtworkKind } from '@lobechat/prompts';

export interface AgentArtworkGenerationState {
  error?: string;
  kind: AgentArtworkKind;
  status: 'error' | 'generating';
}

export interface AgentArtworkSliceState {
  agentArtworkGenerationMap: Record<string, AgentArtworkGenerationState>;
}

export const initialAgentArtworkSliceState: AgentArtworkSliceState = {
  agentArtworkGenerationMap: {},
};
