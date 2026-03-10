import { type StoreApiWithSelector } from '@lobechat/types';
import { type StoreApi } from 'zustand';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';
import { createContext } from 'zustand-utils';

import { type IFeatureFlagsState } from '@/config/featureFlags';
import { DEFAULT_FEATURE_FLAGS, mapFeatureFlagsEnvToState } from '@/config/featureFlags';
import { createDevtools } from '@/store/middleware/createDevtools';
import { type GlobalServerConfig } from '@/types/serverConfig';
import { merge } from '@/utils/merge';

import { flattenActions } from '../utils/flattenActions';
import { type ServerConfigAction } from './action';
import { createServerConfigSlice } from './action';

interface ServerConfigState {
  featureFlags: IFeatureFlagsState;
  isMobile?: boolean;
  segmentVariants?: string;
  serverConfig: GlobalServerConfig;
  serverConfigInit: boolean;
}

const initialState: ServerConfigState = {
  featureFlags: mapFeatureFlagsEnvToState(DEFAULT_FEATURE_FLAGS),
  segmentVariants: '',
  serverConfig: { aiProvider: {}, telemetry: {} },
  serverConfigInit: false,
};

//  ===============  Aggregate createStoreFn ============ //

export interface ServerConfigStore extends ServerConfigState, ServerConfigAction {}

type ServerConfigStoreAction = ServerConfigAction;

type CreateStore = (
  initState: Partial<ServerConfigStore>,
) => StateCreator<ServerConfigStore, [['zustand/devtools', never]]>;

const createStore: CreateStore =
  (runtimeState: any) =>
  (...params) => ({
    ...merge(initialState, runtimeState),
    ...flattenActions<ServerConfigStoreAction>([createServerConfigSlice(...params)]),
  });

//  ===============  Implement useStore ============ //

let store: StoreApi<ServerConfigStore>;

declare global {
  interface Window {
    global_serverConfigStore: StoreApi<ServerConfigStore>;
  }
}

const devtools = createDevtools('serverConfig');

export const initServerConfigStore = (initState: Partial<ServerConfigStore>) =>
  createWithEqualityFn<ServerConfigStore>()(devtools(createStore(initState || {})), shallow);

export const createServerConfigStore = (initState?: Partial<ServerConfigStore>) => {
  // make sure there is only one store
  if (!store) {
    store = createWithEqualityFn<ServerConfigStore>()(
      devtools(createStore(initState || {})),
      shallow,
    );

    if (typeof window !== 'undefined') {
      window.global_serverConfigStore = store;
    }
  }

  return store;
};

export const { useStore: useServerConfigStore, Provider } =
  createContext<StoreApiWithSelector<ServerConfigStore>>();
