import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore, ResetableStoreAction } from '../utils/resetableStore';
import { type EvalStoreState, initialState } from './initialState';
import { type BenchmarkAction, createBenchmarkSlice } from './slices/benchmark/action';
import { type ConnectorAction, createConnectorSlice } from './slices/connector/action';
import { type ConversationAction, createConversationSlice } from './slices/conversation/action';
import { createDatasetSlice, type DatasetAction } from './slices/dataset/action';
import { createExperimentSlice, type ExperimentAction } from './slices/experiment/action';
import { createLobeBenchSlice, type LobeBenchAction } from './slices/lobeBench/action';
import { createRunSlice, type RunAction } from './slices/run/action';
import { createTestCaseSlice, type TestCaseAction } from './slices/testCase/action';

type EvalStoreAction = BenchmarkAction &
  ConnectorAction &
  ConversationAction &
  DatasetAction &
  ExperimentAction &
  LobeBenchAction &
  RunAction &
  TestCaseAction &
  ResetableStore;

export type EvalStore = EvalStoreState & EvalStoreAction;

class EvalStoreResetAction extends ResetableStoreAction<EvalStore> {
  protected readonly resetActionName = 'resetEvalStore';
}

const createStore: StateCreator<EvalStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<EvalStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<EvalStoreAction>([
    createBenchmarkSlice(...parameters),
    createConversationSlice(...parameters),
    createConnectorSlice(...parameters),
    createDatasetSlice(...parameters),
    createExperimentSlice(...parameters),
    createLobeBenchSlice(...parameters),
    createRunSlice(...parameters),
    createTestCaseSlice(...parameters),
    new EvalStoreResetAction(...parameters),
  ]),
});

const devtools = createDevtools('eval');

export const useEvalStore = createWithEqualityFn<EvalStore>()(devtools(createStore), shallow);

expose('eval', useEvalStore);
