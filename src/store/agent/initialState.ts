import { type AgentSliceState } from './slices/agent';
import { initialAgentSliceState } from './slices/agent';
import { type BuiltinAgentSliceState } from './slices/builtin';
import { initialBuiltinAgentSliceState } from './slices/builtin';

export type AgentStoreState = AgentSliceState & BuiltinAgentSliceState;

export const initialState: AgentStoreState = {
  ...initialAgentSliceState,
  ...initialBuiltinAgentSliceState,
};
