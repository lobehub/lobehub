import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { initialState, type ToolStoreState } from './initialState';
import { type AgentSkillsAction, createAgentSkillsSlice } from './slices/agentSkills';
import { type BuiltinToolAction, createBuiltinToolSlice } from './slices/builtin';
import { createCustomPluginSlice, type CustomPluginAction } from './slices/customPlugin';
import { createKlavisStoreSlice, type KlavisStoreAction } from './slices/klavisStore';
import {
  createLobehubSkillStoreSlice,
  type LobehubSkillStoreAction,
} from './slices/lobehubSkillStore';
import { createMCPPluginStoreSlice, type PluginMCPStoreAction } from './slices/mcpStore';
import { createPluginStoreSlice, type PluginStoreAction } from './slices/oldStore';
import { createPluginSlice, type PluginAction } from './slices/plugin';

//  ===============  Aggregate createStoreFn ============ //

export type ToolStore = ToolStoreState &
  CustomPluginAction &
  PluginAction &
  PluginStoreAction &
  BuiltinToolAction &
  PluginMCPStoreAction &
  KlavisStoreAction &
  LobehubSkillStoreAction &
  AgentSkillsAction;

type ToolStoreAction = CustomPluginAction &
  PluginAction &
  PluginStoreAction &
  BuiltinToolAction &
  PluginMCPStoreAction &
  KlavisStoreAction &
  LobehubSkillStoreAction &
  AgentSkillsAction;

const createStore: StateCreator<ToolStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<ToolStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<ToolStoreAction>([
    createPluginSlice(...parameters),
    createCustomPluginSlice(...parameters),
    createPluginStoreSlice(...parameters),
    createBuiltinToolSlice(...parameters),
    createMCPPluginStoreSlice(...parameters),
    createKlavisStoreSlice(...parameters),
    createLobehubSkillStoreSlice(...parameters),
    createAgentSkillsSlice(...parameters),
  ]),
});

//  ===============  Implement useStore ============ //

const devtools = createDevtools('tools');

export const useToolStore = createWithEqualityFn<ToolStore>()(devtools(createStore), shallow);

export const getToolStoreState = () => useToolStore.getState();
