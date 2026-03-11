import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { type EvalStoreState, initialState } from './initialState';
import { type BenchmarkAction, createBenchmarkSlice } from './slices/benchmark/action';
import { createDatasetSlice, type DatasetAction } from './slices/dataset/action';
import { createRunSlice, type RunAction } from './slices/run/action';
import { createTestCaseSlice, type TestCaseAction } from './slices/testCase/action';

export type EvalStore = EvalStoreState &
  BenchmarkAction &
  DatasetAction &
  RunAction &
  TestCaseAction;

const createStore: StateCreator<EvalStore, [['zustand/devtools', never]]> = (set, get, store) => ({
  ...initialState,
  ...createBenchmarkSlice(set, get, store),
  ...createDatasetSlice(set, get, store),
  ...createRunSlice(set, get, store),
  ...createTestCaseSlice(set, get, store),
});

const devtools = createDevtools('eval');

export const useEvalStore = createWithEqualityFn<EvalStore>()(devtools(createStore), shallow);
