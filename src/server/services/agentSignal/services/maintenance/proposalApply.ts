import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';

import type { MaintenanceProposalApplyGateResult } from './brief';
import type {
  MaintenanceProposalAction,
  MaintenanceProposalActionApplyResult,
  MaintenanceProposalApplyAttempt,
  MaintenanceProposalConflictReason,
  MaintenanceProposalMetadata,
} from './proposal';
import type { MaintenanceProposalPreflightResult } from './proposalPreflight';
import type { MaintenanceTools, MaintenanceToolWriteResult } from './tools';
import type { MaintenanceReviewRunResult } from './types';
import { MaintenanceActionStatus, ReviewRunStatus } from './types';

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
  /** Synthetic review result projected from approve-time tool outcomes. */
  result: MaintenanceReviewRunResult;
}

export interface MaintenanceProposalApplyAdapters {
  /** Re-checks one frozen action against current target state. */
  checkAction: (action: MaintenanceProposalAction) => Promise<MaintenanceProposalPreflightResult>;
  /** Re-checks feature/user/agent gates immediately before mutation. */
  checkGates: () => Promise<MaintenanceProposalApplyGateResult>;
  /** Clock injected for deterministic apply-attempt metadata. */
  now?: () => string;
  /** Safe maintenance write tools used for approve-time proposal application. */
  tools: Pick<MaintenanceTools, 'createSkillIfAbsent' | 'replaceSkillContentCAS'>;
  /** Persists updated proposal metadata. */
  updateProposal: (proposal: MaintenanceProposalMetadata) => Promise<void>;
}

interface PreparedToolAction {
  action: MaintenanceProposalAction;
  apply: () => Promise<MaintenanceToolWriteResult>;
}

const toApplyResult = (
  action: MaintenanceProposalAction,
  status: MaintenanceProposalActionApplyResult['status'],
  summary: string,
): MaintenanceProposalActionApplyResult => ({
  idempotencyKey: action.idempotencyKey,
  status,
  summary,
});

const getOptionalString = (value: unknown) => (typeof value === 'string' ? value : undefined);

const getRequiredString = (value: unknown) => {
  const text = getOptionalString(value)?.trim();

  return text || undefined;
};

const mapToolStatus = (
  result: MaintenanceToolWriteResult,
): MaintenanceProposalActionApplyResult['status'] => {
  if (result.status === 'applied') return 'applied';
  if (result.status === 'deduped') return 'deduped';
  if (result.status === 'failed') return 'failed';
  if (result.status === 'skipped_stale') return 'skipped_stale';
  if (result.status === 'skipped_unsupported') return 'skipped_unsupported';

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
    : actionResults.some((result) => result.status === 'applied' || result.status === 'deduped')
      ? ReviewRunStatus.Completed
      : ReviewRunStatus.Skipped,
});

const buildUnsupportedResult = (action: MaintenanceProposalAction) =>
  toApplyResult(
    action,
    'skipped_unsupported',
    'Proposal action is not supported by approve-time apply.',
  );

const prepareToolAction = (
  action: MaintenanceProposalAction,
  input: ApplyMaintenanceProposalInput,
  adapters: MaintenanceProposalApplyAdapters,
): MaintenanceProposalActionApplyResult | PreparedToolAction => {
  if (action.actionType === 'consolidate_skill') {
    if (
      action.operation?.domain !== 'skill' ||
      action.operation.operation !== 'consolidate' ||
      !action.baseSnapshot
    ) {
      return toApplyResult(
        action,
        'skipped_unsupported',
        'Proposal action is missing an executable operation.',
      );
    }

    const operationInput = action.operation.input as unknown as Record<string, unknown>;
    const bodyMarkdown = getRequiredString(operationInput.bodyMarkdown);
    const canonicalSkillDocumentId = getRequiredString(operationInput.canonicalSkillDocumentId);
    const description = getOptionalString(operationInput.description);

    if (!bodyMarkdown || !canonicalSkillDocumentId) {
      return toApplyResult(
        action,
        'skipped_unsupported',
        'Proposal action is missing an executable operation.',
      );
    }

    return {
      action,
      apply: () =>
        adapters.tools.replaceSkillContentCAS({
          baseSnapshot: action.baseSnapshot!,
          bodyMarkdown,
          ...(description ? { description } : {}),
          idempotencyKey: action.idempotencyKey,
          proposalKey: input.proposal.proposalKey,
          skillDocumentId: canonicalSkillDocumentId,
          summary: action.rationale,
          userId: input.userId,
        }),
    };
  }

  if (action.actionType === 'refine_skill') {
    if (
      action.operation?.domain !== 'skill' ||
      action.operation.operation !== 'refine' ||
      !action.baseSnapshot
    ) {
      return toApplyResult(
        action,
        'skipped_unsupported',
        'Proposal action is missing an executable operation.',
      );
    }

    const operation = action.operation;
    const operationInput = operation.input as unknown as Record<string, unknown>;
    const bodyMarkdown = getRequiredString(operation.input.bodyMarkdown);
    const description = getOptionalString(operationInput.description);
    const skillDocumentId = getRequiredString(operation.input.skillDocumentId);

    if (!bodyMarkdown || !skillDocumentId) {
      return toApplyResult(
        action,
        'skipped_unsupported',
        'Proposal action is missing an executable operation.',
      );
    }

    return {
      action,
      apply: () =>
        adapters.tools.replaceSkillContentCAS({
          baseSnapshot: action.baseSnapshot!,
          bodyMarkdown,
          ...(description ? { description } : {}),
          idempotencyKey: action.idempotencyKey,
          proposalKey: input.proposal.proposalKey,
          skillDocumentId,
          summary: action.rationale,
          userId: input.userId,
        }),
    };
  }

  if (action.actionType === 'create_skill') {
    if (action.operation?.domain !== 'skill' || action.operation.operation !== 'create') {
      return toApplyResult(
        action,
        'skipped_unsupported',
        'Proposal action is missing an executable operation.',
      );
    }

    const operation = action.operation;
    const bodyMarkdown = getRequiredString(operation.input.bodyMarkdown);
    const description = getOptionalString(operation.input.description);
    const name = getRequiredString(operation.input.name);
    const title = getOptionalString(operation.input.title);

    if (!bodyMarkdown || !name) {
      return toApplyResult(
        action,
        'skipped_unsupported',
        'Proposal action is missing an executable operation.',
      );
    }

    return {
      action,
      apply: () =>
        adapters.tools.createSkillIfAbsent({
          bodyMarkdown,
          ...(description ? { description } : {}),
          idempotencyKey: action.idempotencyKey,
          name,
          proposalKey: input.proposal.proposalKey,
          summary: action.rationale,
          ...(title ? { title } : {}),
          userId: input.userId,
        }),
    };
  }

  return buildUnsupportedResult(action);
};

/**
 * Creates the approve-time merge path for Agent Signal maintenance proposals.
 *
 * Use when:
 * - A user approves an Agent Signal Daily Brief proposal
 * - Frozen proposal actions must be rechecked before mutation
 *
 * Expects:
 * - Callers persist proposal metadata through `updateProposal`
 * - `tools` are safe maintenance write tools with their own idempotency and mutation guards
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
          const executableActions: PreparedToolAction[] = [];
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

              const prepared = prepareToolAction(action, input, adapters);
              if ('status' in prepared) {
                skippedResults.push(prepared);
                continue;
              }

              executableActions.push(prepared);
            }
          }

          const executedResults = [];
          for (const { action, apply } of executableActions) {
            const result = await apply();
            executedResults.push({
              idempotencyKey: action.idempotencyKey,
              ...(result.resourceId ? { resourceId: result.resourceId } : {}),
              status: mapToolStatus(result),
              ...(result.summary ? { summary: result.summary } : {}),
            });
          }

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
          const execution = buildSyntheticResult(actionResults);

          await adapters.updateProposal(proposal);
          span.setAttribute('agent.signal.proposal.apply_status', proposal.status);
          span.setAttribute(
            'agent.signal.proposal.executable_action_count',
            executableActions.length,
          );
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
