import type { ChaosAdapter, ChaosOracle } from '@achaos/core';

export interface AgentChaosTestState {
  completionDeliveries: number;
  operationStatus: 'running' | 'abandoned' | 'done';
  toolResult?: string;
}

export const createAgentChaosTestState = (): AgentChaosTestState => ({
  completionDeliveries: 0,
  operationStatus: 'running',
});

export const createStateAdapter = (state: AgentChaosTestState): ChaosAdapter => ({
  cleanup: async (receipt) => {
    const previous = receipt.cleanupToken?.operationStatus;
    if (previous === 'running' || previous === 'abandoned' || previous === 'done') {
      state.operationStatus = previous;
    }
  },
  inject: async (context) => {
    const previous = state.operationStatus;
    if (context.experiment.effect.type === 'throw') {
      state.toolResult = JSON.stringify({ errorType: context.experiment.effect.errorType });
    }
    if (context.experiment.target.selector.operationStatus === 'stale') {
      state.operationStatus = 'abandoned';
    }
    return {
      adapter: 'state',
      cleanupToken: { operationStatus: previous },
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
