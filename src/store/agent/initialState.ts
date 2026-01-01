import { type AgentSliceState, initialAgentSliceState } from './slices/agent';
import { type BuiltinAgentSliceState, initialBuiltinAgentSliceState } from './slices/builtin';

export type AgentStoreState = AgentSliceState & BuiltinAgentSliceState;

export const initialState: AgentStoreState = {
  ...initialAgentSliceState,
  ...initialBuiltinAgentSliceState,
};
