// Fixture: the expiry handler checks the status, then hands the whole state
// to the hook dispatcher, so the blob is really needed.
import type { AgentRuntimeCoordinatorDeps } from './types';

export async function expireClientLlmWait(deps: AgentRuntimeCoordinatorDeps, operationId: string) {
  const state = await deps.stateManager.loadAgentState(operationId);
  if (state?.status !== 'waiting_for_client_llm') return;

  await deps.hooks.dispatchHooks(operationId, state, { reason: 'client_llm_wait_expired' });
}
