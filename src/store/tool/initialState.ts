import { type AgentSkillsState, initialAgentSkillsState } from './slices/agentSkills/initialState';
import { type BuiltinToolState, initialBuiltinToolState } from './slices/builtin/initialState';
import {
  type CustomPluginState,
  initialCustomPluginState,
} from './slices/customPlugin/initialState';
import { initialKlavisStoreState, type KlavisStoreState } from './slices/klavisStore/initialState';
import {
  initialLobehubSkillStoreState,
  type LobehubSkillStoreState,
} from './slices/lobehubSkillStore/initialState';
import { initialMCPStoreState, type MCPStoreState } from './slices/mcpStore/initialState';
import { initialPluginStoreState, type PluginStoreState } from './slices/oldStore/initialState';
import { initialPluginState, type PluginState } from './slices/plugin/initialState';

export type ToolStoreState = PluginState &
  CustomPluginState &
  PluginStoreState &
  BuiltinToolState &
  MCPStoreState &
  KlavisStoreState &
  LobehubSkillStoreState &
  AgentSkillsState;

export const initialState: ToolStoreState = {
  ...initialPluginState,
  ...initialCustomPluginState,
  ...initialPluginStoreState,
  ...initialBuiltinToolState,
  ...initialMCPStoreState,
  ...initialKlavisStoreState,
  ...initialLobehubSkillStoreState,
  ...initialAgentSkillsState,
};
