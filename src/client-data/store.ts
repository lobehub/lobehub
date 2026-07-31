import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';

import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';
import { flattenActions } from '@/store/utils/flattenActions';
import { isDev } from '@/utils/env';

import { type ClientDataCoreAction, createClientDataCoreAction } from './core/action';
import { type ClientDataStoreState, initialState } from './core/initialState';
import { type ClientDataEntityAction, createClientDataEntityAction } from './entities/action';
import { createHomeClientDataAction, type HomeClientDataAction } from './modules/home/action';
import { clientDataRepository } from './registry';

export type ClientDataAction = ClientDataCoreAction & ClientDataEntityAction & HomeClientDataAction;

export interface ClientDataStore
  extends
    ClientDataStoreState,
    ClientDataCoreAction,
    ClientDataEntityAction,
    HomeClientDataAction {}

const createStore: StateCreator<ClientDataStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<ClientDataStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<ClientDataAction>([
    createClientDataCoreAction(clientDataRepository, ...parameters),
    createClientDataEntityAction(...parameters),
    createHomeClientDataAction(...parameters),
  ]),
});

const devtools = createDevtools('clientData');

export const useClientDataStore = createWithEqualityFn<ClientDataStore>()(
  subscribeWithSelector(
    devtools(createStore, {
      name: 'LobeChat_ClientData' + (isDev ? '_DEV' : ''),
    }),
  ),
  shallow,
);

expose('clientData', useClientDataStore);

export const getClientDataStoreState = () => useClientDataStore.getState();
