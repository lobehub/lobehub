import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type ToolStoreState, initialState } from './initialState';
import { type BuiltinToolAction, createBuiltinToolSlice } from './slices/builtin';
import { type CustomPluginAction, createCustomPluginSlice } from './slices/customPlugin';
import { type KlavisStoreAction, createKlavisStoreSlice } from './slices/klavisStore';
import {
  type LobehubSkillStoreAction,
  createLobehubSkillStoreSlice,
} from './slices/lobehubSkillStore';
import { type PluginMCPStoreAction, createMCPPluginStoreSlice } from './slices/mcpStore';
import { type PluginStoreAction, createPluginStoreSlice } from './slices/oldStore';
import { type PluginAction, createPluginSlice } from './slices/plugin';

//  ===============  Aggregate createStoreFn ============ //

export type ToolStore = ToolStoreState &
  CustomPluginAction &
  PluginAction &
  PluginStoreAction &
  BuiltinToolAction &
  PluginMCPStoreAction &
  KlavisStoreAction &
  LobehubSkillStoreAction;

type ToolStoreAction = CustomPluginAction &
  PluginAction &
  PluginStoreAction &
  BuiltinToolAction &
  PluginMCPStoreAction &
  KlavisStoreAction &
  LobehubSkillStoreAction;

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
  ]),
});

//  ===============  Implement useStore ============ //

const devtools = createDevtools('tools');

export const useToolStore = createWithEqualityFn<ToolStore>()(devtools(createStore), shallow);

export const getToolStoreState = () => useToolStore.getState();
