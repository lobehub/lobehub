'use client';

import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';

import { type Store, store } from './action';

export type { State } from './initialState';
export type {
  QuotaAccount,
  QuotaBinding,
  QuotaHistory,
  QuotaLatestReading,
  QuotaPanelSnapshot,
  QuotaUsageTurn,
  QuotaWindowRow,
} from './projection';

const devtools = createDevtools('agentQuota');

export const useAgentQuotaStore = createWithEqualityFn<Store>()(devtools(store), shallow);

expose('agentQuota', useAgentQuotaStore);

export const getAgentQuotaStoreState = () => useAgentQuotaStore.getState();

export { agentQuotaSelectors } from './selectors';
