import type { AgentInterventionItem } from '../../schemas';
import { AGENT_INTERVENTION_INVALID_ACTION } from './constants';
import type { AgentInterventionContext } from './context';
import type { ClaimAgentInterventionBatchParams } from './types';
import {
  actionCapability,
  hasExactKeys,
  hasValidAnswers,
  hasValidCustomResult,
  providerOptionIds,
  sameJson,
} from './utils';

export function hasValidSealedSnapshot(
  rows: AgentInterventionItem[],
  params: ClaimAgentInterventionBatchParams,
): boolean {
  const ids = rows.map((row) => row.id);
  if (
    rows.length !== params.expectedItemCount ||
    rows.some(
      (row, index) => !row.sealed || row.itemCount !== rows.length || row.itemIndex !== index,
    ) ||
    !hasExactKeys(params.expectedVersions, ids) ||
    !hasExactKeys(params.expectedRequestRevisionHashes, ids)
  ) {
    return false;
  }
  return rows.every(
    (row) =>
      params.expectedVersions[row.id] === row.version &&
      params.expectedRequestRevisionHashes[row.id] === row.requestRevisionHash,
  );
}

export function hasValidSelection(
  rows: AgentInterventionItem[],
  targets: AgentInterventionItem[],
  params: ClaimAgentInterventionBatchParams,
  selectedIds: string[],
): boolean {
  if (selectedIds.length === 0 || targets.length !== selectedIds.length) return false;
  if (params.scope === 'single' && selectedIds.length !== 1) return false;
  if (params.action.type === 'stop') {
    // Let validateAction surface an invalid stop scope as a contract error,
    // rather than disguising it as a stale-snapshot conflict.
    if (params.scope !== 'all') return true;
    // A published/resolving sibling already won a competing decision and must
    // finish before an operation-wide stop can safely claim the remainder.
    if (rows.some((row) => row.status === 'resolving' || row.status === 'published')) return false;
    const pendingIds = rows
      .filter((row) => row.status === 'pending')
      .map((row) => row.id)
      .sort();
    return sameJson(pendingIds, selectedIds);
  }
  if (params.scope === 'all') {
    const batchIds = rows.map((row) => row.id).sort();
    return sameJson(batchIds, selectedIds);
  }
  return true;
}

export function validateAction(
  ctx: AgentInterventionContext,
  targets: AgentInterventionItem[],
  params: ClaimAgentInterventionBatchParams,
) {
  const capability = actionCapability(params.action);
  if (targets.some((row) => !row.allowedActions.includes(capability))) {
    throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
  }
  if (
    (params.action.type === 'approve' || params.action.type === 'approve_remember') &&
    params.action.editedArguments &&
    (params.scope !== 'single' ||
      targets.length !== 1 ||
      !targets[0].allowedActions.includes('edit_arguments'))
  ) {
    throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
  }
  if (
    params.action.type === 'approve_remember' &&
    (params.scope !== 'single' ||
      targets.length !== 1 ||
      params.actorId !== ctx.userId ||
      !targets[0].canonicalToolKey)
  ) {
    throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
  }
  if (
    params.action.type === 'select_provider_option' &&
    (targets.length !== 1 ||
      !providerOptionIds(targets[0].sanitizedRequest).has(params.action.optionId))
  ) {
    throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
  }
  if (
    params.action.type === 'submit_answers' &&
    (targets.length !== 1 || !hasValidAnswers(targets[0].sanitizedRequest, params.action.answers))
  ) {
    throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
  }
  if (
    params.action.type === 'submit_custom' &&
    (targets.length !== 1 ||
      params.action.expectedRevisionHash !== targets[0].requestRevisionHash ||
      !hasValidCustomResult(targets[0].sanitizedRequest, params.action.result))
  ) {
    throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
  }
  if (
    params.action.type === 'stop' &&
    (params.action.haltScope !== 'operation' || params.scope !== 'all')
  ) {
    throw new Error(AGENT_INTERVENTION_INVALID_ACTION);
  }
}
