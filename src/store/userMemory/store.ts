import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type UserMemoryStoreState } from './initialState';
import { initialState } from './initialState';
import { type ActivityAction } from './slices/activity';
import { createActivitySlice } from './slices/activity';
import { type AgentMemoryAction } from './slices/agent';
import { createAgentMemorySlice } from './slices/agent';
import { type BaseAction } from './slices/base';
import { createBaseSlice } from './slices/base';
import { type ContextAction } from './slices/context';
import { createContextSlice } from './slices/context';
import { type ExperienceAction } from './slices/experience';
import { createExperienceSlice } from './slices/experience';
import { type HomeAction } from './slices/home';
import { createHomeSlice } from './slices/home';
import { type IdentityAction } from './slices/identity';
import { createIdentitySlice } from './slices/identity';
import { type PreferenceAction } from './slices/preference';
import { createPreferenceSlice } from './slices/preference';

export type UserMemoryStore = UserMemoryStoreState &
  ActivityAction &
  AgentMemoryAction &
  BaseAction &
  ContextAction &
  ExperienceAction &
  HomeAction &
  IdentityAction &
  PreferenceAction;

type UserMemoryStoreAction = ActivityAction &
  AgentMemoryAction &
  BaseAction &
  ContextAction &
  ExperienceAction &
  HomeAction &
  IdentityAction &
  PreferenceAction;

const createStore: StateCreator<UserMemoryStore, [['zustand/devtools', never]]> = (
  set: any,
  get: any,
  store: any,
) => ({
  ...initialState,
  ...flattenActions<UserMemoryStoreAction>([
    createActivitySlice(set, get, store),
    createAgentMemorySlice(set, get, store),
    createBaseSlice(set, get, store),
    createContextSlice(set, get, store),
    createExperienceSlice(set, get, store),
    createHomeSlice(set, get, store),
    createIdentitySlice(set, get, store),
    createPreferenceSlice(set, get, store),
  ]),
});

const devtools = createDevtools('userMemory');

export const useUserMemoryStore = createWithEqualityFn<UserMemoryStore>()(
  devtools(createStore),
  shallow,
);

export const getUserMemoryStoreState = () => useUserMemoryStore.getState();
