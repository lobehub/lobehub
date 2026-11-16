import { benchmarkInitialState, type BenchmarkSliceState } from './slices/benchmark/initialState';
import { connectorInitialState, type ConnectorSliceState } from './slices/connector/initialState';
import {
  conversationInitialState,
  type ConversationSliceState,
} from './slices/conversation/initialState';
import { datasetInitialState, type DatasetSliceState } from './slices/dataset/initialState';
import {
  experimentInitialState,
  type ExperimentSliceState,
} from './slices/experiment/initialState';
import { lobeBenchInitialState, type LobeBenchSliceState } from './slices/lobeBench/initialState';
import { runInitialState, type RunSliceState } from './slices/run/initialState';
import { testCaseInitialState, type TestCaseSliceState } from './slices/testCase/initialState';

export interface EvalStoreState
  extends
    BenchmarkSliceState,
    ConnectorSliceState,
    ConversationSliceState,
    DatasetSliceState,
    ExperimentSliceState,
    LobeBenchSliceState,
    RunSliceState,
    TestCaseSliceState {}

export const initialState: EvalStoreState = {
  ...benchmarkInitialState,
  ...connectorInitialState,
  ...conversationInitialState,
  ...datasetInitialState,
  ...experimentInitialState,
  ...lobeBenchInitialState,
  ...runInitialState,
  ...testCaseInitialState,
};
