import type { ChaosAdapter, ChaosOracle } from '@achaos/core';

export interface AgentChaosTestState {
  completionDeliveries: number;
  operationLease: 'active' | 'stale';
  operationStatus: 'running' | 'abandoned' | 'done';
  toolResult?: string;
}

export const createAgentChaosTestState = (): AgentChaosTestState => ({
  completionDeliveries: 0,
  operationLease: 'active',
  operationStatus: 'running',
});

/** Test exercise that represents the production coordinator's reclaim behavior. */
export const reclaimStaleOperation = (state: AgentChaosTestState) => {
  if (state.operationLease === 'stale' && state.operationStatus === 'running') {
    state.operationStatus = 'abandoned';
  }
};

export const createStateAdapter = (state: AgentChaosTestState): ChaosAdapter => ({
  cancelInjection: async () => {},
  cleanup: async (receipt) => {
    const previousLease = receipt.cleanupToken?.operationLease;
    const previous = receipt.cleanupToken?.operationStatus;
    const previousToolResult = receipt.cleanupToken?.toolResult;
    if (previousLease === 'active' || previousLease === 'stale') {
      state.operationLease = previousLease;
    }
    if (previous === 'running' || previous === 'abandoned' || previous === 'done') {
      state.operationStatus = previous;
    }
    if (typeof previousToolResult === 'string') state.toolResult = previousToolResult;
    else delete state.toolResult;
  },
  inject: async (context) => {
    const previousLease = state.operationLease;
    const previous = state.operationStatus;
    const previousToolResult = state.toolResult;
    if (context.experiment.effect.type === 'throw') {
      state.toolResult = JSON.stringify({ errorType: context.experiment.effect.errorType });
    }
    if (
      context.experiment.target.selector.operationStatus === 'running' &&
      context.experiment.effect.type === 'delay'
    ) {
      state.operationLease = 'stale';
    }
    return {
      adapter: 'state',
      cleanupToken: {
        operationLease: previousLease,
        operationStatus: previous,
        toolResult: previousToolResult,
      },
      injectionId: `${context.runId}:state`,
    };
  },
  name: 'state',
});

export const createStateOracle = (
  state: AgentChaosTestState,
  name: string,
  evaluate: (current: AgentChaosTestState) => { message: string; passed: boolean },
): ChaosOracle => ({
  evaluate: async () => {
    const result = evaluate(state);
    return { message: result.message, name, status: result.passed ? 'passed' : 'failed' };
  },
  name,
});
