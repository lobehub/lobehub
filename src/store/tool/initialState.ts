import {
  type AgentDocumentSkillsState,
  initialAgentDocumentSkillsState,
} from './slices/agentDocumentSkills/initialState';
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
import { initialPluginState, type PluginState } from './slices/plugin/initialState';

export type ToolStoreState = PluginState &
  CustomPluginState &
  BuiltinToolState &
  MCPStoreState &
  KlavisStoreState &
  LobehubSkillStoreState &
  AgentSkillsState &
  AgentDocumentSkillsState;

export const initialState: ToolStoreState = {
  ...initialPluginState,
  ...initialCustomPluginState,
  ...initialBuiltinToolState,
  ...initialMCPStoreState,
  ...initialKlavisStoreState,
  ...initialLobehubSkillStoreState,
  ...initialAgentSkillsState,
  ...initialAgentDocumentSkillsState,
};
