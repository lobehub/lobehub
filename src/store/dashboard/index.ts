'use client';

import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '@/store/middleware/createDevtools';
import { flattenActions } from '@/store/utils/flattenActions';

import { type DashboardAction, DashboardActionImpl, type DashboardStore } from './action';
import { initialState } from './initialState';

const devtools = createDevtools('dashboard');

export const useDashboardStore = createWithEqualityFn<DashboardStore>()(
  devtools((...parameters) => ({
    ...initialState,
    ...flattenActions<DashboardAction>([new DashboardActionImpl(...parameters)]),
  })),
  shallow,
);

export const getDashboardStoreState = () => useDashboardStore.getState();

export { dashboardLevelKey } from './initialState';
export { dashboardSelectors } from './selectors';
