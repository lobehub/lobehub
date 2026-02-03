import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type AgentStoreState, initialState } from './initialState';
import { type AgentSliceAction, createAgentSlice } from './slices/agent';
import { type BuiltinAgentSliceAction, createBuiltinAgentSlice } from './slices/builtin';
import { type CronSliceAction, createCronSlice } from './slices/cron';
import { type KnowledgeSliceAction, createKnowledgeSlice } from './slices/knowledge';
import { type PluginSliceAction, createPluginSlice } from './slices/plugin';

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
