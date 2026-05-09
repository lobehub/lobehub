import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';

import type { CreateMaintenanceReviewReceiptsInput } from '../receiptService';
import type { MaintenanceProposalApplyGateResult } from './brief';
import type {
  MaintenanceProposalAction,
  MaintenanceProposalActionApplyResult,
  MaintenanceProposalApplyAttempt,
  MaintenanceProposalConflictReason,
  MaintenanceProposalMetadata,
} from './proposal';
import type { MaintenanceProposalPreflightResult } from './proposalPreflight';
import type { MaintenanceActionResult, MaintenancePlan, MaintenanceReviewRunResult } from './types';
import {
  MaintenanceActionStatus,
  MaintenanceApplyMode,
  MaintenanceReviewScope,
  MaintenanceRisk,
  ReviewRunStatus,
} from './types';

export interface ApplyMaintenanceProposalInput {
  /** Agent that owns the proposal target. */
  agentId: string;
  /** User-local date when the proposal is tied to a nightly run. */
  localDate?: string;
  /** Frozen proposal metadata read from Daily Brief metadata. */
  proposal: MaintenanceProposalMetadata;
  /** Source id used for approve-time receipts and idempotency context. */
  sourceId: string;
  /** Source type used for approve-time receipts. */
  sourceType: string;
  /** IANA timezone used for nightly receipt metadata. */
  timezone?: string;
  /** User that owns the proposal. */
  userId: string;
}

export interface ApplyMaintenanceProposalResult {
  /** Proposal metadata after the apply attempt has been recorded. */
  proposal: MaintenanceProposalMetadata;
  /** Executor result for mergeable actions, or a synthetic result for skipped-only attempts. */
  result: MaintenanceReviewRunResult;
}

export interface MaintenanceProposalApplyAdapters {
  /** Re-checks one frozen action against current target state. */
  checkAction: (action: MaintenanceProposalAction) => Promise<MaintenanceProposalPreflightResult>;
  /** Re-checks feature/user/agent gates immediately before mutation. */
  checkGates: () => Promise<MaintenanceProposalApplyGateResult>;
  /** Executes the fresh subset through the normal maintenance executor. */
  executePlan: (plan: MaintenancePlan) => Promise<MaintenanceReviewRunResult>;
  /** Clock injected for deterministic apply-attempt metadata. */
  now?: () => string;
  /** Persists updated proposal metadata. */
  updateProposal: (proposal: MaintenanceProposalMetadata) => Promise<void>;
  /** Persists approve-time receipts for the executed subset. */
  writeReceipts?: (input: CreateMaintenanceReviewReceiptsInput) => Promise<void>;
}

interface PreparedAction {
  action: MaintenanceProposalAction;
  planAction: MaintenancePlan['actions'][number];
}

const toPlanAction = (
  action: MaintenanceProposalAction,
): MaintenancePlan['actions'][number] | undefined => {
  if (!action.operation) return;

  return {
    actionType: action.actionType,
    applyMode: MaintenanceApplyMode.AutoApply,
    confidence: 1,
    dedupeKey: action.idempotencyKey,
    evidenceRefs: action.evidenceRefs,
    idempotencyKey: action.idempotencyKey,
    operation: action.operation,
    rationale: action.rationale,
    risk: action.risk ?? MaintenanceRisk.Medium,
    ...(action.target ? { target: action.target } : {}),
  };
};

const toApplyResult = (
  action: MaintenanceProposalAction,
  status: MaintenanceProposalActionApplyResult['status'],
  summary: string,
): MaintenanceProposalActionApplyResult => ({
  idempotencyKey: action.idempotencyKey,
  status,
  summary,
});

const mapExecutionStatus = (
  result: MaintenanceActionResult,
): MaintenanceProposalActionApplyResult['status'] => {
  if (result.status === MaintenanceActionStatus.Applied) return 'applied';
  if (result.status === MaintenanceActionStatus.Deduped) return 'deduped';
  if (result.status === MaintenanceActionStatus.Failed) return 'failed';

  return 'skipped_unsupported';
};

const getAttemptStatus = (
  actionResults: MaintenanceProposalActionApplyResult[],
): MaintenanceProposalApplyAttempt['status'] => {
  const hasApplied = actionResults.some(
    (result) => result.status === 'applied' || result.status === 'deduped',
  );
  const hasFailed = actionResults.some(
    (result) => result.status === 'failed' || result.status === 'skipped_unsupported',
  );
  const hasStale = actionResults.some((result) => result.status === 'skipped_stale');

  if (hasApplied && (hasFailed || hasStale)) return 'partially_failed';
  if (hasApplied) return 'applied';
  if (hasStale && !hasFailed) return 'stale';

  return 'failed';
};

const getProposalStatus = (status: MaintenanceProposalApplyAttempt['status']) => {
  if (status === 'applied') return 'applied';
  if (status === 'partially_failed') return 'partially_failed';
  if (status === 'stale') return 'stale';

  return 'failed';
};

const getFirstConflictReason = (
  result: MaintenanceProposalPreflightResult,
): MaintenanceProposalConflictReason | undefined => {
  if (result.allowed || result.reason === 'unsupported') return;

  return result.reason;
};

const buildSyntheticResult = (
  actionResults: MaintenanceProposalActionApplyResult[],
): MaintenanceReviewRunResult => ({
  actions: actionResults.map((result) => ({
    idempotencyKey: result.idempotencyKey,
    ...(result.resourceId ? { resourceId: result.resourceId } : {}),
    status:
      result.status === 'failed'
        ? MaintenanceActionStatus.Failed
        : result.status === 'deduped'
          ? MaintenanceActionStatus.Deduped
          : result.status === 'applied'
            ? MaintenanceActionStatus.Applied
            : MaintenanceActionStatus.Skipped,
    ...(result.summary ? { summary: result.summary } : {}),
  })),
  status: actionResults.some((result) => result.status === 'failed')
    ? ReviewRunStatus.Failed
    : ReviewRunStatus.Skipped,
});

/**
 * Creates the approve-time merge path for Agent Signal maintenance proposals.
 *
 * Use when:
 * - A user approves an Agent Signal Daily Brief proposal
 * - Frozen proposal actions must be rechecked before mutation
 *
 * Expects:
 * - Callers persist proposal metadata through `updateProposal`
 * - `executePlan` is the same executor family used by nightly maintenance
 *
 * Returns:
 * - A service that records one apply attempt and never reruns reviewer/planner
 */
export const createMaintenanceProposalApplyService = (
  adapters: MaintenanceProposalApplyAdapters,
) => ({
  apply: async (input: ApplyMaintenanceProposalInput): Promise<ApplyMaintenanceProposalResult> =>
    tracer.startActiveSpan(
      'agent_signal.maintenance_proposal.apply',
      {
        attributes: {
          'agent.signal.agent_id': input.agentId,
          'agent.signal.proposal.action_count': input.proposal.actions.length,
          'agent.signal.proposal.key': input.proposal.proposalKey,
          'agent.signal.source_id': input.sourceId,
          'agent.signal.user_id': input.userId,
        },
      },
      async (span) => {
        try {
          const now = adapters.now?.() ?? new Date().toISOString();
          const gateResult = await adapters.checkGates();
          const skippedResults: MaintenanceProposalActionApplyResult[] = [];
          const executableActions: PreparedAction[] = [];
          let conflictReason: MaintenanceProposalConflictReason | undefined;

          if (!gateResult.allowed) {
            conflictReason = gateResult.reason;
            skippedResults.push(
              ...input.proposal.actions.map((action) =>
                toApplyResult(action, 'skipped_stale', `Proposal blocked: ${gateResult.reason}.`),
              ),
            );
          } else {
            for (const action of input.proposal.actions) {
              const preflight = await adapters.checkAction(action);
              if (!preflight.allowed) {
                conflictReason ??= getFirstConflictReason(preflight);
                skippedResults.push(
                  toApplyResult(
                    action,
                    preflight.reason === 'unsupported' ? 'skipped_unsupported' : 'skipped_stale',
                    preflight.reason === 'unsupported'
                      ? 'Proposal action is not supported by approve-time apply.'
                      : `Proposal target changed: ${preflight.reason}.`,
                  ),
                );
                continue;
              }

              const planAction = toPlanAction(action);
              if (!planAction) {
                skippedResults.push(
                  toApplyResult(
                    action,
                    'skipped_unsupported',
                    'Proposal action is missing an executable operation.',
                  ),
                );
                continue;
              }

              executableActions.push({ action, planAction });
            }
          }

          const plan: MaintenancePlan = {
            actions: executableActions.map(({ planAction }) => planAction),
            plannerVersion: 'maintenance-proposal-apply-v1',
            reviewScope: MaintenanceReviewScope.Nightly,
            summary: `Apply maintenance proposal ${input.proposal.proposalKey}.`,
            ...(input.localDate ? { localDate: input.localDate } : {}),
          };
          const execution =
            plan.actions.length > 0
              ? await adapters.executePlan(plan)
              : buildSyntheticResult(skippedResults);
          const executionByKey = new Map(
            execution.actions.map((result) => [result.idempotencyKey, result]),
          );
          const executedResults = executableActions.map(({ action }) => {
            const result = executionByKey.get(action.idempotencyKey);
            if (!result) {
              return toApplyResult(action, 'failed', 'Executor did not return an action result.');
            }

            return {
              idempotencyKey: action.idempotencyKey,
              ...(result.resourceId ? { resourceId: result.resourceId } : {}),
              status: mapExecutionStatus(result),
              ...(result.summary ? { summary: result.summary } : {}),
            };
          });
          const applyResultByKey = new Map(
            [...executedResults, ...skippedResults].map((result) => [
              result.idempotencyKey,
              result,
            ]),
          );
          const actionResults = input.proposal.actions.map(
            (action) =>
              applyResultByKey.get(action.idempotencyKey) ??
              toApplyResult(action, 'failed', 'Proposal action was not evaluated.'),
          );
          const attemptStatus = getAttemptStatus(actionResults);
          const applyAttempt: MaintenanceProposalApplyAttempt = {
            actionResults,
            appliedAt: now,
            status: attemptStatus,
          };
          const proposal: MaintenanceProposalMetadata = {
            ...input.proposal,
            applyAttempts: [...(input.proposal.applyAttempts ?? []), applyAttempt],
            ...(conflictReason ? { conflictReason } : {}),
            status: getProposalStatus(attemptStatus),
            updatedAt: now,
          };

          if (plan.actions.length > 0 && adapters.writeReceipts) {
            await adapters.writeReceipts({
              agentId: input.agentId,
              createdAt: Date.parse(now),
              ...(input.localDate ? { localDate: input.localDate } : {}),
              plan,
              result: execution,
              sourceId: input.sourceId,
              sourceType: input.sourceType,
              ...(input.timezone ? { timezone: input.timezone } : {}),
              userId: input.userId,
            });
          }

          await adapters.updateProposal(proposal);
          span.setAttribute('agent.signal.proposal.apply_status', proposal.status);
          span.setAttribute('agent.signal.proposal.executable_action_count', plan.actions.length);
          if (conflictReason) {
            span.setAttribute('agent.signal.proposal.conflict_reason', conflictReason);
          }
          span.setStatus({ code: SpanStatusCode.OK });

          return { proposal, result: execution };
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          span.end();
        }
      },
    ),
});
