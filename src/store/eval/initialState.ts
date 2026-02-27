import { type BenchmarkSliceState, benchmarkInitialState } from './slices/benchmark/initialState';
import { type DatasetSliceState, datasetInitialState } from './slices/dataset/initialState';
import { type RunSliceState, runInitialState } from './slices/run/initialState';
import { type TestCaseSliceState, testCaseInitialState } from './slices/testCase/initialState';

export interface EvalStoreState
  extends BenchmarkSliceState,
    DatasetSliceState,
    RunSliceState,
    TestCaseSliceState {}

export const initialState: EvalStoreState = {
  ...benchmarkInitialState,
  ...datasetInitialState,
  ...runInitialState,
  ...testCaseInitialState,
};
