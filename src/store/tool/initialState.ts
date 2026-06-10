import {
  type AgentDocumentSkillsState,
  initialAgentDocumentSkillsState,
} from './slices/agentDocumentSkills/initialState';
import { type AgentSkillsState, initialAgentSkillsState } from './slices/agentSkills/initialState';
import { type BuiltinToolState, initialBuiltinToolState } from './slices/builtin/initialState';
import {
  type ComposioStoreState,
  initialComposioStoreState,
} from './slices/composioStore/initialState';
import { type ConnectorState, initialConnectorState } from './slices/connector/initialState';
import {
  type CustomPluginState,
  initialCustomPluginState,
} from './slices/customPlugin/initialState';
import {
  initialLobehubSkillStoreState,
  type LobehubSkillStoreState,
} from './slices/lobehubSkillStore/initialState';
import { initialMCPStoreState, type MCPStoreState } from './slices/mcpStore/initialState';
import { initialPluginState, type PluginState } from './slices/plugin/initialState';

export type ToolStoreState = ConnectorState &
  PluginState &
  CustomPluginState &
  BuiltinToolState &
  MCPStoreState &
  ComposioStoreState &
  LobehubSkillStoreState &
  AgentSkillsState &
  AgentDocumentSkillsState;

export const initialState: ToolStoreState = {
  ...initialConnectorState,
  ...initialPluginState,
  ...initialCustomPluginState,
  ...initialBuiltinToolState,
  ...initialMCPStoreState,
  ...initialComposioStoreState,
  ...initialLobehubSkillStoreState,
  ...initialAgentSkillsState,
  ...initialAgentDocumentSkillsState,
};
