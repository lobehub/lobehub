// Fixture: the status comes from the metadata hash; the blob is loaded only
// in the rare case an old writer saved a state without `stepCount`.
import type { AgentRuntimeCoordinatorDeps, StepResult } from './types';

export async function saveStepResult(
  deps: AgentRuntimeCoordinatorDeps,
  operationId: string,
  stepResult: StepResult,
) {
  const previousStatus = await deps.stateManager.loadAgentStatus(operationId);
  const previousStepCount =
    stepResult.newState.stepCount === undefined
      ? (await deps.stateManager.loadAgentState(operationId))?.stepCount
      : undefined;

  await deps.stateManager.saveStepResult(operationId, stepResult);

  if (previousStatus !== 'done' && stepResult.newState.status === 'done') {
    const stepIndex = stepResult.newState.stepCount ?? previousStepCount ?? 0;
    await deps.streamManager.publishStreamEnd(operationId, stepIndex);
  }
}
