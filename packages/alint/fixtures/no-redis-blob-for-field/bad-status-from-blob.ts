// Fixture: the abort poll and the step-result save both download the whole
// state blob (hundreds of KB) only to compare its status.
import type { AgentRuntimeCoordinatorDeps, AgentState, StepResult } from './types';

const ABORT_POLL_MS = 1500;

export function startStepAbortPoll(deps: AgentRuntimeCoordinatorDeps, operationId: string) {
  return setInterval(async () => {
    // alint-expect
    const state = await deps.stateManager.loadAgentState(operationId);
    if (state?.status === 'interrupted') deps.abortController.abort();
  }, ABORT_POLL_MS);
}

export async function saveStepResult(
  deps: AgentRuntimeCoordinatorDeps,
  operationId: string,
  stepResult: StepResult,
) {
  // alint-expect
  const previousState: AgentState | null = await deps.stateManager.loadAgentState(operationId);

  await deps.stateManager.saveStepResult(operationId, stepResult);

  if (previousState?.status !== 'done' && stepResult.newState.status === 'done') {
    await deps.streamManager.publishStreamEnd(operationId);
  }
}
