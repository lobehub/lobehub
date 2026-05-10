import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';

import type { MaintenanceProposalBaseSnapshot } from './proposal';
import type { EvidenceRef } from './types';

/** Terminal status emitted by safe maintenance write tools. */
export type MaintenanceToolWriteStatus =
  | 'applied'
  | 'deduped'
  | 'failed'
  | 'proposed'
  | 'skipped_stale'
  | 'skipped_unsupported';

/** Public result returned by safe maintenance write tools. */
export interface MaintenanceToolWriteResult {
  /** Receipt written for the terminal tool outcome. */
  receiptId?: string;
  /** Resource touched or considered by the maintenance tool. */
  resourceId?: string;
  /** Terminal write safety status. */
  status: MaintenanceToolWriteStatus;
  /** Bounded human-readable tool result. */
  summary?: string;
}

/** Successful preflight result for a maintenance write targeting an existing resource. */
export interface MaintenanceToolPreflightAllowed {
  /** Whether the target is still safe to mutate. */
  allowed: true;
}

/** Failed preflight result for a maintenance write targeting an existing resource. */
export interface MaintenanceToolPreflightDenied {
  /** Whether the target is still safe to mutate. */
  allowed: false;
  /** Short stale/conflict reason to store in the receipt. */
  reason: string;
}

/** Preflight result emitted before existing-resource writes. */
export type MaintenanceToolPreflightResult =
  | MaintenanceToolPreflightAllowed
  | MaintenanceToolPreflightDenied;

/** Shared write envelope accepted by all maintenance tools. */
export interface MaintenanceToolWriteInput {
  /** Stable operation key used to dedupe repeated tool calls. */
  idempotencyKey: string;
  /** Stable proposal key used for proposal-scoped tracing and receipts. */
  proposalKey?: string;
  /** Optional caller-provided summary, bounded before persistence. */
  summary?: string;
  /** User that owns the maintenance operation. */
  userId: string;
}

/** Input for replacing one managed skill using compare-and-swap safety checks. */
export interface ReplaceSkillContentCASInput extends MaintenanceToolWriteInput {
  /** Complete target snapshot captured when the proposal was created. */
  baseSnapshot?: MaintenanceProposalBaseSnapshot;
  /** Replacement skill body. */
  bodyMarkdown: string;
  /** Optional replacement description. */
  description?: string;
  /** Existing managed skill document id. */
  skillDocumentId: string;
}

/** Input for creating one skill when no existing skill has been selected. */
export interface CreateSkillIfAbsentInput extends MaintenanceToolWriteInput {
  /** Skill body or authoring payload. */
  bodyMarkdown: string;
  /** Optional skill description. */
  description?: string;
  /** Stable skill name. */
  name: string;
  /** Optional skill title. */
  title?: string;
}

/** Input for writing one durable memory candidate from explicit nightly evidence. */
export interface WriteMemoryInput extends MaintenanceToolWriteInput {
  /** Candidate durable memory content. */
  content: string;
  /** Evidence supporting this memory write. */
  evidenceRefs: EvidenceRef[];
}

/** Input for listing managed skills in one agent scope. */
export interface ListManagedSkillsInput {
  /** Agent whose managed skills are visible to the tool call. */
  agentId: string;
  /** User that owns the read operation. */
  userId: string;
}

/** Input for reading one managed skill in one agent scope. */
export interface GetManagedSkillInput extends ListManagedSkillsInput {
  /** Existing managed skill document id. */
  skillDocumentId: string;
}

/** Input for listing maintenance proposals in one agent scope. */
export interface ListMaintenanceProposalsInput {
  /** Agent whose proposals are visible to the tool call. */
  agentId: string;
  /** User that owns the read operation. */
  userId: string;
}

/** Input for reading an evidence digest in one agent scope. */
export interface GetEvidenceDigestInput {
  /** Agent whose evidence is visible to the tool call. */
  agentId: string;
  /** Optional bounded evidence ids selected by the caller. */
  evidenceIds?: string[];
  /** Optional inclusive review window end timestamp. */
  reviewWindowEnd?: string;
  /** Optional inclusive review window start timestamp. */
  reviewWindowStart?: string;
  /** User that owns the read operation. */
  userId: string;
}

/** Input for creating one user-visible maintenance proposal. */
export interface CreateMaintenanceProposalInput extends MaintenanceToolWriteInput {
  /** Proposal action payload retained by the injected proposal adapter. */
  actions?: unknown[];
  /** Proposal metadata retained by the injected proposal adapter. */
  metadata?: Record<string, unknown>;
}

/** Input for refreshing an existing maintenance proposal. */
export interface RefreshMaintenanceProposalInput extends MaintenanceToolWriteInput {
  /** Existing proposal id to refresh. */
  proposalId: string;
}

/** Input for superseding an existing maintenance proposal. */
export interface SupersedeMaintenanceProposalInput extends MaintenanceToolWriteInput {
  /** Existing proposal id to supersede. */
  proposalId: string;
  /** Replacement proposal key or id. */
  supersededBy: string;
}

/** Input for closing an existing maintenance proposal. */
export interface CloseMaintenanceProposalInput extends MaintenanceToolWriteInput {
  /** Existing proposal id to close. */
  proposalId: string;
  /** Lifecycle reason recorded by the injected adapter. */
  reason?: string;
}

/** Result returned by mutation adapters before receipt persistence. */
export interface MaintenanceToolMutationResult {
  /** Resource created or updated by the adapter. */
  resourceId?: string;
  /** Short adapter summary. */
  summary?: string;
}

/** Receipt write request emitted after every terminal write outcome. */
export interface MaintenanceToolReceiptInput extends MaintenanceToolWriteResult {
  /** Stable operation key used to dedupe repeated tool calls. */
  idempotencyKey: string;
  /** Stable proposal key used for proposal-scoped tracing and receipts. */
  proposalKey?: string;
  /** Tool that produced this receipt. */
  toolName: string;
  /** User that owns the maintenance operation. */
  userId: string;
}

/** Receipt adapter result. */
export interface MaintenanceToolReceiptResult {
  /** Persisted receipt id. */
  receiptId?: string;
}

/** Lifecycle request emitted after a reserved maintenance operation reaches a terminal state. */
export interface MaintenanceToolOperationLifecycleInput extends MaintenanceToolReceiptInput {
  /** Persisted terminal receipt id, when the receipt adapter returns one. */
  receiptId?: string;
}

/** Lifecycle request emitted when a reserved operation cannot write its terminal receipt. */
export interface MaintenanceToolOperationFailureInput extends MaintenanceToolReceiptInput {
  /** Error thrown while writing the terminal receipt. */
  error: unknown;
}

/** Atomic reservation result for a newly claimed maintenance operation. */
export interface MaintenanceToolReservedOperation {
  /** True when the adapter atomically claimed this idempotency key for mutation. */
  reserved: true;
}

/** Atomic reservation result for a previously completed maintenance operation. */
export interface MaintenanceToolExistingOperation {
  /** Prior terminal operation result returned without running mutation. */
  existing: MaintenanceToolWriteResult;
  /** False when the adapter found an existing terminal operation for this key. */
  reserved: false;
}

/** Atomic idempotency reservation emitted before any write preflight or mutation. */
export type MaintenanceToolOperationReservation =
  | MaintenanceToolExistingOperation
  | MaintenanceToolReservedOperation;

/** Adapters used by safe maintenance read/write tools. */
export interface MaintenanceToolsAdapters {
  /** Closes an existing maintenance proposal. */
  closeProposal?: (input: CloseMaintenanceProposalInput) => Promise<MaintenanceToolMutationResult>;
  /**
   * Marks a reserved idempotency operation as terminal after its receipt is persisted.
   *
   * Adapters that store in-progress reservations should use this hook to make the terminal
   * receipt/result the dedupe source of truth. Without it, repeated calls may either rerun
   * mutation or leave reservations stuck in an in-progress state.
   */
  completeOperation?: (input: MaintenanceToolOperationLifecycleInput) => Promise<void>;
  /** Completes server-owned CAS metadata before validating an existing skill replacement. */
  completeReplaceSkillInput?: (
    input: ReplaceSkillContentCASInput,
  ) => Promise<ReplaceSkillContentCASInput>;
  /** Creates one user-visible maintenance proposal. */
  createProposal?: (
    input: CreateMaintenanceProposalInput,
  ) => Promise<MaintenanceToolMutationResult & { proposalId?: string }>;
  /** Creates one managed skill. */
  createSkill?: (input: CreateSkillIfAbsentInput) => Promise<MaintenanceToolMutationResult>;
  /** Reads a bounded evidence digest for maintenance planning. */
  getEvidenceDigest?: (input: GetEvidenceDigestInput) => Promise<unknown | undefined>;
  /** Reads one managed skill in the requested agent scope. */
  getManagedSkill?: (input: GetManagedSkillInput) => Promise<unknown | undefined>;
  /** Lists maintenance proposals in the requested agent scope. */
  listMaintenanceProposals?: (input: ListMaintenanceProposalsInput) => Promise<unknown[]>;
  /** Lists managed skills in the requested agent scope. */
  listManagedSkills?: (input: ListManagedSkillsInput) => Promise<unknown[]>;
  /**
   * Marks or releases a reserved operation when its terminal receipt cannot be persisted.
   *
   * Adapters should make this hook prevent duplicate mutation while avoiding permanently stuck
   * reservations. A common implementation records the failure against the idempotency key and
   * releases retryable reservation state only when the mutation contract is safe to retry.
   */
  markOperationFailed?: (input: MaintenanceToolOperationFailureInput) => Promise<void>;
  /** Checks freshness and writability before mutating existing resources. */
  preflight?: (
    input:
      | CloseMaintenanceProposalInput
      | RefreshMaintenanceProposalInput
      | ReplaceSkillContentCASInput
      | SupersedeMaintenanceProposalInput,
  ) => Promise<MaintenanceToolPreflightResult>;
  /** Reads an existing maintenance proposal. */
  readProposal?: (input: {
    proposalId?: string;
    proposalKey?: string;
    userId: string;
  }) => Promise<unknown>;
  /** Refreshes an existing maintenance proposal. */
  refreshProposal?: (
    input: RefreshMaintenanceProposalInput,
  ) => Promise<MaintenanceToolMutationResult>;
  /** Replaces existing managed skill content after CAS preflight. */
  replaceSkill?: (input: ReplaceSkillContentCASInput) => Promise<MaintenanceToolMutationResult>;
  /** Atomically reserves an idempotency key before any preflight or mutation runs. */
  reserveOperation: (idempotencyKey: string) => Promise<MaintenanceToolOperationReservation>;
  /** Supersedes an existing maintenance proposal. */
  supersedeProposal?: (
    input: SupersedeMaintenanceProposalInput,
  ) => Promise<MaintenanceToolMutationResult>;
  /** Writes one durable memory candidate. */
  writeMemory?: (input: WriteMemoryInput) => Promise<MaintenanceToolMutationResult>;
  /** Writes the audit receipt for a terminal maintenance tool status. */
  writeReceipt: (input: MaintenanceToolReceiptInput) => Promise<MaintenanceToolReceiptResult>;
}

const MAX_SUMMARY_LENGTH = 240;

/**
 * Normalizes maintenance tool summaries.
 *
 * Before:
 * - `"  A very   long summary ...  "`
 *
 * After:
 * - `"A very long summary ..."`
 */
const boundSummary = (summary: string | undefined) => {
  if (!summary) return undefined;

  const normalized = summary.trim().replaceAll(/\s+/g, ' ');

  return normalized.length > MAX_SUMMARY_LENGTH
    ? `${normalized.slice(0, MAX_SUMMARY_LENGTH - 3)}...`
    : normalized;
};

const errorSummary = (error: unknown) =>
  boundSummary(error instanceof Error ? error.message : String(error));

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const hasNonBlankString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isCompleteRefineBaseSnapshot = (
  snapshot: unknown,
): snapshot is MaintenanceProposalBaseSnapshot & {
  agentDocumentId: string;
  contentHash: string;
  documentId: string;
} => {
  if (!snapshot || typeof snapshot !== 'object') return false;

  const record = snapshot as Record<string, unknown>;

  return (
    record.targetType === 'skill' &&
    hasNonBlankString(record.agentDocumentId) &&
    hasNonBlankString(record.documentId) &&
    hasNonBlankString(record.contentHash) &&
    record.managed === true &&
    record.writable === true
  );
};

const getResultWithReceipt = async (
  adapters: MaintenanceToolsAdapters,
  input: MaintenanceToolWriteInput,
  toolName: string,
  result: MaintenanceToolWriteResult,
): Promise<MaintenanceToolWriteResult> => {
  const boundedResult = { ...result, summary: boundSummary(result.summary) };
  const receipt = await adapters.writeReceipt({
    ...boundedResult,
    idempotencyKey: input.idempotencyKey,
    proposalKey: input.proposalKey,
    toolName,
    userId: input.userId,
  });

  return { ...boundedResult, receiptId: receipt.receiptId ?? boundedResult.receiptId };
};

const withWriteSpan = async <TInput extends MaintenanceToolWriteInput>(
  toolName: string,
  input: TInput,
  operation: (
    recordConvertedException: (error: unknown) => void,
  ) => Promise<MaintenanceToolWriteResult>,
) => {
  return tracer.startActiveSpan(
    'agent_signal.maintenance_tool.write',
    {
      attributes: {
        'agent.signal.maintenance_tool.name': toolName,
        ...(input.proposalKey ? { 'agent.signal.proposal.key': input.proposalKey } : {}),
      },
    },
    async (span) => {
      try {
        const result = await operation((error) => span.recordException(error as Error));

        span.setAttribute('agent.signal.maintenance_tool.write_status', result.status);
        span.setStatus({
          code: result.status === 'failed' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        });

        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: getErrorMessage(error) });

        throw error;
      } finally {
        span.end();
      }
    },
  );
};

const withReadSpan = async <TResult>(
  toolName: string,
  proposalKey: string | undefined,
  operation: () => Promise<TResult>,
) => {
  return tracer.startActiveSpan(
    'agent_signal.maintenance_tool.read',
    {
      attributes: {
        'agent.signal.maintenance_tool.name': toolName,
        ...(proposalKey ? { 'agent.signal.proposal.key': proposalKey } : {}),
      },
    },
    async (span) => {
      try {
        const result = await operation();

        span.setStatus({ code: SpanStatusCode.OK });

        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: getErrorMessage(error) });

        throw error;
      } finally {
        span.end();
      }
    },
  );
};

const runWriteTool = async <TInput extends MaintenanceToolWriteInput>({
  adapters,
  input,
  mutate,
  preflight,
  preflightRequired,
  resourceId,
  successStatus,
  toolName,
  unsupportedSummary,
  validate,
}: {
  adapters: MaintenanceToolsAdapters;
  input: TInput;
  mutate?: () => Promise<MaintenanceToolMutationResult>;
  preflight?: () => Promise<MaintenanceToolPreflightResult>;
  preflightRequired?: boolean;
  resourceId?: string;
  successStatus: Exclude<
    MaintenanceToolWriteStatus,
    'deduped' | 'failed' | 'skipped_stale' | 'skipped_unsupported'
  >;
  toolName: string;
  unsupportedSummary: string;
  validate?: () => MaintenanceToolWriteResult | undefined;
}) => {
  return withWriteSpan(toolName, input, async (recordConvertedException) => {
    let operationReserved = false;
    const result = await (async (): Promise<MaintenanceToolWriteResult> => {
      try {
        const reservation = await adapters.reserveOperation(input.idempotencyKey);

        if (!reservation.reserved) {
          return {
            resourceId: reservation.existing.resourceId,
            status: 'deduped',
            summary: reservation.existing.summary,
          };
        }

        operationReserved = true;

        const validationResult = validate?.();
        if (validationResult) return validationResult;

        if (!mutate) {
          return {
            resourceId,
            status: 'skipped_unsupported',
            summary: unsupportedSummary,
          };
        }

        if (preflightRequired && !preflight) {
          return {
            resourceId,
            status: 'skipped_unsupported',
            summary: 'Maintenance preflight is not supported.',
          };
        }

        if (preflight) {
          const preflightResult = await preflight();

          if (!preflightResult.allowed) {
            return {
              resourceId,
              status: 'skipped_stale',
              summary: preflightResult.reason || input.summary,
            };
          }
        }

        const mutationResult = await mutate();

        return {
          resourceId: mutationResult.resourceId ?? resourceId,
          status: successStatus,
          summary: mutationResult.summary ?? input.summary,
        };
      } catch (error) {
        recordConvertedException(error);

        return {
          resourceId,
          status: 'failed',
          summary: errorSummary(error),
        };
      }
    })();

    try {
      const resultWithReceipt = await getResultWithReceipt(adapters, input, toolName, result);

      if (operationReserved) {
        await adapters.completeOperation?.({
          ...resultWithReceipt,
          idempotencyKey: input.idempotencyKey,
          proposalKey: input.proposalKey,
          toolName,
          userId: input.userId,
        });
      }

      return resultWithReceipt;
    } catch (error) {
      if (operationReserved) {
        await adapters.markOperationFailed?.({
          ...result,
          error,
          idempotencyKey: input.idempotencyKey,
          proposalKey: input.proposalKey,
          toolName,
          userId: input.userId,
        });
      }

      throw error;
    }
  });
};

/**
 * Creates safe read/write maintenance tools with injected domain adapters.
 *
 * Use when:
 * - Agent Signal needs callable maintenance tools before runner wiring
 * - Tests need to verify write safety contracts without database services
 *
 * Expects:
 * - `idempotencyKey` is stable per intended write
 * - Existing-resource writes inject `preflight` before mutation
 *
 * Returns:
 * - Tool functions that dedupe, preflight, mutate, receipt, and trace consistently
 */
export const createMaintenanceTools = (adapters: MaintenanceToolsAdapters) => ({
  closeMaintenanceProposal: async (input: CloseMaintenanceProposalInput) =>
    runWriteTool({
      adapters,
      input,
      mutate: adapters.closeProposal ? () => adapters.closeProposal!(input) : undefined,
      preflight: adapters.preflight ? () => adapters.preflight!(input) : undefined,
      preflightRequired: true,
      resourceId: input.proposalId,
      successStatus: 'applied',
      toolName: 'closeMaintenanceProposal',
      unsupportedSummary: 'Maintenance proposal close is not supported.',
    }),
  createMaintenanceProposal: async (input: CreateMaintenanceProposalInput) =>
    runWriteTool({
      adapters,
      input,
      mutate: adapters.createProposal
        ? async () => {
            const result = await adapters.createProposal!(input);

            return {
              resourceId: result.resourceId ?? result.proposalId,
              summary: result.summary,
            };
          }
        : undefined,
      successStatus: 'proposed',
      toolName: 'createMaintenanceProposal',
      unsupportedSummary: 'Maintenance proposal creation is not supported.',
    }),
  createSkillIfAbsent: async (input: CreateSkillIfAbsentInput) =>
    runWriteTool({
      adapters,
      input,
      mutate: adapters.createSkill ? () => adapters.createSkill!(input) : undefined,
      successStatus: 'applied',
      toolName: 'createSkillIfAbsent',
      unsupportedSummary: 'Skill creation is not supported.',
      validate: () => {
        if (hasNonBlankString(input.name) && hasNonBlankString(input.bodyMarkdown)) {
          return undefined;
        }

        return {
          status: 'skipped_unsupported',
          summary: 'Skill creation requires a non-empty name and body.',
        };
      },
    }),
  writeMemory: async (input: WriteMemoryInput) =>
    runWriteTool({
      adapters,
      input,
      mutate: adapters.writeMemory ? () => adapters.writeMemory!(input) : undefined,
      successStatus: 'applied',
      toolName: 'writeMemory',
      unsupportedSummary: 'Memory writing is not supported.',
    }),
  getEvidenceDigest: async (input: GetEvidenceDigestInput) =>
    withReadSpan('getEvidenceDigest', undefined, async () => {
      if (!adapters.getEvidenceDigest) return undefined;

      return adapters.getEvidenceDigest(input);
    }),
  getManagedSkill: async (input: GetManagedSkillInput) =>
    withReadSpan('getManagedSkill', undefined, async () => {
      if (!adapters.getManagedSkill) return undefined;

      return adapters.getManagedSkill(input);
    }),
  listMaintenanceProposals: async (input: ListMaintenanceProposalsInput) =>
    withReadSpan('listMaintenanceProposals', undefined, async () => {
      if (!adapters.listMaintenanceProposals) return [];

      return adapters.listMaintenanceProposals(input);
    }),
  listManagedSkills: async (input: ListManagedSkillsInput) =>
    withReadSpan('listManagedSkills', undefined, async () => {
      if (!adapters.listManagedSkills) return [];

      return adapters.listManagedSkills(input);
    }),
  readMaintenanceProposal: async (input: {
    proposalId?: string;
    proposalKey?: string;
    userId: string;
  }) =>
    withReadSpan('readMaintenanceProposal', input.proposalKey, async () => {
      if (!adapters.readProposal) return undefined;

      return adapters.readProposal(input);
    }),
  refreshMaintenanceProposal: async (input: RefreshMaintenanceProposalInput) =>
    runWriteTool({
      adapters,
      input,
      mutate: adapters.refreshProposal ? () => adapters.refreshProposal!(input) : undefined,
      preflight: adapters.preflight ? () => adapters.preflight!(input) : undefined,
      preflightRequired: true,
      resourceId: input.proposalId,
      successStatus: 'proposed',
      toolName: 'refreshMaintenanceProposal',
      unsupportedSummary: 'Maintenance proposal refresh is not supported.',
    }),
  replaceSkillContentCAS: async (input: ReplaceSkillContentCASInput) => {
    const enrichedInput = adapters.completeReplaceSkillInput
      ? await adapters.completeReplaceSkillInput(input)
      : input;

    return runWriteTool({
      adapters,
      input: enrichedInput,
      mutate: adapters.replaceSkill ? () => adapters.replaceSkill!(enrichedInput) : undefined,
      preflight: adapters.preflight ? () => adapters.preflight!(enrichedInput) : undefined,
      preflightRequired: true,
      resourceId: enrichedInput.skillDocumentId,
      successStatus: 'applied',
      toolName: 'replaceSkillContentCAS',
      unsupportedSummary: 'Skill replacement is not supported.',
      validate: () => {
        if (!hasNonBlankString(enrichedInput.bodyMarkdown)) {
          return {
            resourceId: enrichedInput.skillDocumentId,
            status: 'skipped_unsupported',
            summary: 'Skill replacement requires a non-empty body.',
          };
        }

        if (isCompleteRefineBaseSnapshot(enrichedInput.baseSnapshot)) return undefined;

        return {
          resourceId: enrichedInput.skillDocumentId,
          status: 'skipped_unsupported',
          summary: 'Skill replacement requires a complete base snapshot.',
        };
      },
    });
  },
  supersedeMaintenanceProposal: async (input: SupersedeMaintenanceProposalInput) =>
    runWriteTool({
      adapters,
      input,
      mutate: adapters.supersedeProposal ? () => adapters.supersedeProposal!(input) : undefined,
      preflight: adapters.preflight ? () => adapters.preflight!(input) : undefined,
      preflightRequired: true,
      resourceId: input.proposalId,
      successStatus: 'applied',
      toolName: 'supersedeMaintenanceProposal',
      unsupportedSummary: 'Maintenance proposal supersede is not supported.',
    }),
});

/** Callable safe maintenance tools exposed to bounded maintenance agent runners. */
export type MaintenanceTools = ReturnType<typeof createMaintenanceTools>;
