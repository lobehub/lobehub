import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type ToolStoreState } from './initialState';
import { initialState } from './initialState';
import { type BuiltinToolAction } from './slices/builtin';
import { createBuiltinToolSlice } from './slices/builtin';
import { type CustomPluginAction } from './slices/customPlugin';
import { createCustomPluginSlice } from './slices/customPlugin';
import { type KlavisStoreAction } from './slices/klavisStore';
import { createKlavisStoreSlice } from './slices/klavisStore';
import { type LobehubSkillStoreAction } from './slices/lobehubSkillStore';
import { createLobehubSkillStoreSlice } from './slices/lobehubSkillStore';
import { type PluginMCPStoreAction } from './slices/mcpStore';
import { createMCPPluginStoreSlice } from './slices/mcpStore';
import { type PluginStoreAction } from './slices/oldStore';
import { createPluginStoreSlice } from './slices/oldStore';
import { type PluginAction } from './slices/plugin';
import { createPluginSlice } from './slices/plugin';

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
