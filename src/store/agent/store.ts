import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type AgentStoreState } from './initialState';
import { initialState } from './initialState';
import { type AgentSliceAction } from './slices/agent';
import { createAgentSlice } from './slices/agent';
import { type BuiltinAgentSliceAction } from './slices/builtin';
import { createBuiltinAgentSlice } from './slices/builtin';
import { type CronSliceAction } from './slices/cron';
import { createCronSlice } from './slices/cron';
import { type KnowledgeSliceAction } from './slices/knowledge';
import { createKnowledgeSlice } from './slices/knowledge';
import { type PluginSliceAction } from './slices/plugin';
import { createPluginSlice } from './slices/plugin';

//  ===============  aggregate createStoreFn ============ //

export interface AgentStore
  extends
    AgentSliceAction,
    BuiltinAgentSliceAction,
    CronSliceAction,
    KnowledgeSliceAction,
    PluginSliceAction,
    AgentStoreState {}

type AgentStoreAction = AgentSliceAction &
  BuiltinAgentSliceAction &
  CronSliceAction &
  KnowledgeSliceAction &
  PluginSliceAction;

const createStore: StateCreator<AgentStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<AgentStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<AgentStoreAction>([
    createAgentSlice(...parameters),
    createBuiltinAgentSlice(...parameters),
    createCronSlice(...parameters),
    createKnowledgeSlice(...parameters),
    createPluginSlice(...parameters),
  ]),
});

//  ===============  implement useStore ============ //

const devtools = createDevtools('agent');

export const useAgentStore = createWithEqualityFn<AgentStore>()(devtools(createStore), shallow);

export const getAgentStoreState = () => useAgentStore.getState();
