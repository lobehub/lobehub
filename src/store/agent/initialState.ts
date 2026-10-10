import { type AgentSliceState } from './slices/agent';
import { initialAgentSliceState } from './slices/agent';
import { type AgentArtworkSliceState, initialAgentArtworkSliceState } from './slices/artwork';
import { type BotSliceState } from './slices/bot';
import { initialBotSliceState } from './slices/bot';
import { type BuiltinAgentSliceState } from './slices/builtin';
import { initialBuiltinAgentSliceState } from './slices/builtin';

export type AgentStoreState = AgentArtworkSliceState &
  AgentSliceState &
  BotSliceState &
  BuiltinAgentSliceState;

export const initialState: AgentStoreState = {
  ...initialAgentArtworkSliceState,
  ...initialAgentSliceState,
  ...initialBotSliceState,
  ...initialBuiltinAgentSliceState,
};
