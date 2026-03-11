import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type AIProviderStoreState } from './initialState';
import { initialState } from './initialState';
import { type AiModelAction } from './slices/aiModel';
import { createAiModelSlice } from './slices/aiModel';
import { type AiProviderAction } from './slices/aiProvider';
import { createAiProviderSlice } from './slices/aiProvider';

//  ===============  Aggregate createStoreFn ============ //

export interface AiInfraStore extends AIProviderStoreState, AiProviderAction, AiModelAction {
  /* empty */
}

type AiInfraStoreAction = AiProviderAction & AiModelAction;

const createStore: StateCreator<AiInfraStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<AiInfraStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<AiInfraStoreAction>([
    createAiModelSlice(...parameters),
    createAiProviderSlice(...parameters),
  ]),
});

//  ===============  Implement useStore ============ //
const devtools = createDevtools('aiInfra');

export const useAiInfraStore = createWithEqualityFn<AiInfraStore>()(devtools(createStore), shallow);

export const getAiInfraStoreState = () => useAiInfraStore.getState();
