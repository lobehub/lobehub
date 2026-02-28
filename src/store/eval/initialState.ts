import { benchmarkInitialState, type BenchmarkSliceState } from './slices/benchmark/initialState';
import { datasetInitialState, type DatasetSliceState } from './slices/dataset/initialState';
import { runInitialState, type RunSliceState } from './slices/run/initialState';
import { testCaseInitialState, type TestCaseSliceState } from './slices/testCase/initialState';

export interface EvalStoreState
  extends BenchmarkSliceState, DatasetSliceState, RunSliceState, TestCaseSliceState {}

export const initialState: EvalStoreState = {
  ...benchmarkInitialState,
  ...datasetInitialState,
  ...runInitialState,
  ...testCaseInitialState,
};
