import { type AgentSliceState } from './slices/agent';
import { initialAgentSliceState } from './slices/agent';
import { type AgentArtworkSliceState, initialAgentArtworkSliceState } from './slices/artwork';
import { type BuiltinAgentSliceState } from './slices/builtin';
import { initialBuiltinAgentSliceState } from './slices/builtin';
import { initialKnowledgeSliceState, type KnowledgeSliceState } from './slices/knowledge';

export type AgentStoreState = AgentArtworkSliceState &
  AgentSliceState &
  BuiltinAgentSliceState &
  KnowledgeSliceState;

export const initialState: AgentStoreState = {
  ...initialAgentArtworkSliceState,
  ...initialAgentSliceState,
  ...initialBuiltinAgentSliceState,
  ...initialKnowledgeSliceState,
};
