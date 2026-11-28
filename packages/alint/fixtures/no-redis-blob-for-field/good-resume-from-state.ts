// Fixture: the next step runs from the loaded state, so the whole blob is used.
import type { AgentRuntimeCoordinatorDeps } from './types';

export async function executeNextStep(deps: AgentRuntimeCoordinatorDeps, operationId: string) {
  const state = await deps.stateManager.loadAgentState(operationId);
  if (!state) throw new Error(`operation ${operationId} has no state`);

  const runtime = await deps.createRuntime(state);
  const result = await runtime.step(state, state.pendingContext);

  await deps.stateManager.saveStepResult(operationId, result);
  return result;
}
