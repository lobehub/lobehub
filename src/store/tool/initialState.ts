import { type BuiltinToolState } from './slices/builtin/initialState';
import { initialBuiltinToolState } from './slices/builtin/initialState';
import { type CustomPluginState } from './slices/customPlugin/initialState';
import { initialCustomPluginState } from './slices/customPlugin/initialState';
import { type KlavisStoreState } from './slices/klavisStore/initialState';
import { initialKlavisStoreState } from './slices/klavisStore/initialState';
import { type LobehubSkillStoreState } from './slices/lobehubSkillStore/initialState';
import { initialLobehubSkillStoreState } from './slices/lobehubSkillStore/initialState';
import { type MCPStoreState } from './slices/mcpStore/initialState';
import { initialMCPStoreState } from './slices/mcpStore/initialState';
import { type PluginStoreState } from './slices/oldStore/initialState';
import { initialPluginStoreState } from './slices/oldStore/initialState';
import { type PluginState } from './slices/plugin/initialState';
import { initialPluginState } from './slices/plugin/initialState';

export type ToolStoreState = PluginState &
  CustomPluginState &
  PluginStoreState &
  BuiltinToolState &
  MCPStoreState &
  KlavisStoreState &
  LobehubSkillStoreState;

export const initialState: ToolStoreState = {
  ...initialPluginState,
  ...initialCustomPluginState,
  ...initialPluginStoreState,
  ...initialBuiltinToolState,
  ...initialMCPStoreState,
  ...initialKlavisStoreState,
  ...initialLobehubSkillStoreState,
};
