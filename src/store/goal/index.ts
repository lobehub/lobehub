'use client';

import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '@/store/middleware/createDevtools';
import { expose } from '@/store/middleware/expose';
import { flattenActions } from '@/store/utils/flattenActions';

import { type GoalAction, GoalActionImpl, type GoalStore } from './action';
import { initialState } from './initialState';

const devtools = createDevtools('goal');

export const useGoalStore = createWithEqualityFn<GoalStore>()(
  devtools((...parameters) => ({
    ...initialState,
    ...flattenActions<GoalAction>([new GoalActionImpl(...parameters)]),
  })),
  shallow,
);

expose('goal', useGoalStore);

export const getGoalStoreState = () => useGoalStore.getState();

export { goalStatusesForFilter } from './goalListFilter';
export type { GoalListFilter, GoalViewMode } from './initialState';
export { goalSelectors } from './selectors';
