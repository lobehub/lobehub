import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore, ResetableStoreAction } from '../utils/resetableStore';
import { initialState, type ToolStoreState } from './initialState';
import {
  type AgentDocumentSkillsAction,
  createAgentDocumentSkillsSlice,
} from './slices/agentDocumentSkills';
import { type AgentSkillsAction, createAgentSkillsSlice } from './slices/agentSkills';
import { type BuiltinToolAction, createBuiltinToolSlice } from './slices/builtin';
import { type ConnectorAction, createConnectorSlice } from './slices/connector';
import { createCustomPluginSlice, type CustomPluginAction } from './slices/customPlugin';
import { createKlavisStoreSlice, type KlavisStoreAction } from './slices/klavisStore';
import {
  createLobehubSkillStoreSlice,
  type LobehubSkillStoreAction,
} from './slices/lobehubSkillStore';
import { createMCPPluginStoreSlice, type PluginMCPStoreAction } from './slices/mcpStore';
import { createPluginSlice, type PluginAction } from './slices/plugin';

//  ===============  Aggregate createStoreFn ============ //

export type ToolStore = ToolStoreState &
  ConnectorAction &
  CustomPluginAction &
  PluginAction &
  BuiltinToolAction &
  PluginMCPStoreAction &
  KlavisStoreAction &
  LobehubSkillStoreAction &
  AgentSkillsAction &
  AgentDocumentSkillsAction &
  ResetableStore;

type ToolStoreAction = ConnectorAction &
  CustomPluginAction &
  PluginAction &
  BuiltinToolAction &
  PluginMCPStoreAction &
  KlavisStoreAction &
  LobehubSkillStoreAction &
  AgentSkillsAction &
  AgentDocumentSkillsAction &
  ResetableStore;

class ToolStoreResetAction extends ResetableStoreAction<ToolStore> {
  protected readonly resetActionName = 'resetToolStore';
}

const createStore: StateCreator<ToolStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<ToolStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<ToolStoreAction>([
    createConnectorSlice(...parameters),
    createPluginSlice(...parameters),
    createCustomPluginSlice(...parameters),
    createBuiltinToolSlice(...parameters),
    createMCPPluginStoreSlice(...parameters),
    createKlavisStoreSlice(...parameters),
    createLobehubSkillStoreSlice(...parameters),
    createAgentSkillsSlice(...parameters),
    createAgentDocumentSkillsSlice(...parameters),
    new ToolStoreResetAction(...parameters),
  ]),
});

//  ===============  Implement useStore ============ //

const devtools = createDevtools('tools');

export const useToolStore = createWithEqualityFn<ToolStore>()(devtools(createStore), shallow);

expose('tool', useToolStore);

export const getToolStoreState = () => useToolStore.getState();
