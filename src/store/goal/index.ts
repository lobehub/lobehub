'use client';

import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '@/store/middleware/createDevtools';
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

export const getGoalStoreState = () => useGoalStore.getState();

export { goalSelectors } from './selectors';
