import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type AssistantAction, createAssistantSlice } from './slices/assistant/action';
import { type GroupAgentAction, createGroupAgentSlice } from './slices/groupAgent/action';
import { type MCPAction, createMCPSlice } from './slices/mcp';
import { type ModelAction, createModelSlice } from './slices/model/action';
import { type PluginAction, createPluginSlice } from './slices/plugin/action';
import { type ProviderAction, createProviderSlice } from './slices/provider/action';
import { type SocialAction, createSocialSlice } from './slices/social';
import { type UserAction, createUserSlice } from './slices/user';

//  ===============  Aggregate createStoreFn ============ //

export type DiscoverStore = MCPAction &
  AssistantAction &
  GroupAgentAction &
  ProviderAction &
  ModelAction &
  PluginAction &
  SocialAction &
  UserAction;

type DiscoverStoreAction = MCPAction &
  AssistantAction &
  GroupAgentAction &
  ProviderAction &
  ModelAction &
  PluginAction &
  SocialAction &
  UserAction;

const createStore: StateCreator<DiscoverStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<DiscoverStore, [['zustand/devtools', never]]>>
) =>
  flattenActions<DiscoverStoreAction>([
    createMCPSlice(...parameters),
    createAssistantSlice(...parameters),
    createGroupAgentSlice(...parameters),
    createProviderSlice(...parameters),
    createModelSlice(...parameters),
    createPluginSlice(...parameters),
    createSocialSlice(...parameters),
    createUserSlice(...parameters),
  ]);

//  ===============  Implement useStore ============ //

const devtools = createDevtools('discover');

export const useDiscoverStore = createWithEqualityFn<DiscoverStore>()(
  devtools(createStore),
  shallow,
);

export const getDiscoverStoreState = () => useDiscoverStore.getState();
