import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type AssistantAction } from './slices/assistant/action';
import { createAssistantSlice } from './slices/assistant/action';
import { type GroupAgentAction } from './slices/groupAgent/action';
import { createGroupAgentSlice } from './slices/groupAgent/action';
import { type MCPAction } from './slices/mcp';
import { createMCPSlice } from './slices/mcp';
import { type ModelAction } from './slices/model/action';
import { createModelSlice } from './slices/model/action';
import { type PluginAction } from './slices/plugin/action';
import { createPluginSlice } from './slices/plugin/action';
import { type ProviderAction } from './slices/provider/action';
import { createProviderSlice } from './slices/provider/action';
import { type SocialAction } from './slices/social';
import { createSocialSlice } from './slices/social';
import { type UserAction } from './slices/user';
import { createUserSlice } from './slices/user';

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
