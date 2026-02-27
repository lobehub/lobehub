import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { type EvalStoreState, initialState } from './initialState';
import { type BenchmarkAction, createBenchmarkSlice } from './slices/benchmark/action';
import { type DatasetAction, createDatasetSlice } from './slices/dataset/action';
import { type RunAction, createRunSlice } from './slices/run/action';
import { type TestCaseAction, createTestCaseSlice } from './slices/testCase/action';

export type EvalStore = EvalStoreState &
  BenchmarkAction &
  DatasetAction &
  RunAction &
  TestCaseAction;

const createStore: StateCreator<EvalStore, [['zustand/devtools', never]]> = (
  set,
  get,
  store,
) => ({
  ...initialState,
  ...createBenchmarkSlice(set, get, store),
  ...createDatasetSlice(set, get, store),
  ...createRunSlice(set, get, store),
  ...createTestCaseSlice(set, get, store),
});

const devtools = createDevtools('eval');

export const useEvalStore = createWithEqualityFn<EvalStore>()(devtools(createStore), shallow);
