import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';

import type { SelfReviewProposalBaseSnapshot } from '../review/proposal';
import type { EvidenceRef } from '../types';

// TODO: Replace keyword regexp checks with a structured memory safety policy.
// Regex matching is too coarse for durable memory decisions and can both over-block benign
// content and miss unsafe phrasing that avoids these exact words.
const UNSAFE_AUTOMATIC_MEMORY_PATTERNS = [
  /\bprobably\b/i,
  /\bmaybe\b/i,
  /\bmedical\b/i,
  /\bhealth\b/i,
  /\brelationship\b/i,
  /\bfinance\b/i,
];

/** Input required to write one memory candidate. */
export interface MemoryWriteInput {
  /** Candidate durable memory content. */
  content: string;
  /** User that owns the memory. */
  userId: string;
}

/** Request envelope for one memory write. */
export interface MemoryWriteRequest {
  /** Evidence supporting the memory write. */
  evidenceRefs: EvidenceRef[];
  /** Stable action idempotency key. */
  idempotencyKey: string;
  /** Domain payload for memory persistence. */
  input: MemoryWriteInput;
}

/** Result returned after a memory write adapter applies a candidate. */
export interface MemoryWriteResult {
  /** Durable memory id. */
  memoryId: string;
  /** Optional short persistence summary. */
  summary?: string;
}

/** Persistence adapter for memory writes. */
export interface MemoryWriter {
  /** Writes memory through the existing memory extraction/persistence stack. */
  writeMemory?: (input: {
    content: string;
    evidenceRefs: EvidenceRef[];
    idempotencyKey: string;
    userId: string;
  }) => Promise<MemoryWriteResult>;
}

/**
 * Error thrown when an injected same-turn adapter needs executor-style status mapping.
 */
export class MemoryActionError extends Error {
  /** Status that should be surfaced by the same-turn action handler. */
  status: 'failed' | 'skipped';

  /**
   * Creates a memory action status error.
   *
   * Use when:
   * - A legacy same-turn memory runner returns skipped or failed
   * - The memory service is used as the validation boundary
   *
   * Expects:
   * - `status` is not `applied`
   *
   * Returns:
   * - An error with a stable status for handler mapping
   */
  constructor(message: string, status: 'failed' | 'skipped') {
    super(message);
    this.name = 'MemoryActionError';
    this.status = status;
  }
}

/** Common fields for skill domain requests. */
export interface SkillBaseInput {
  /** Whether the resolved target is immutable because it is builtin, marketplace, or otherwise protected. */
  targetReadonly?: boolean;
  /** User that owns the writable managed skill. */
  userId: string;
}

/** Input for creating a managed skill. */
export interface SkillCreateInput extends SkillBaseInput {
  /** Skill body or authoring payload. */
  bodyMarkdown?: string;
  /** Optional description. */
  description?: string;
  /** Stable skill name. */
  name?: string;
  /** Optional title. */
  title?: string;
}

/** Input for refining an existing managed skill. */
export interface SkillRefineInput extends SkillBaseInput {
  /** Full replacement Markdown body without YAML frontmatter. */
  bodyMarkdown?: string;
  /** Human-readable proposal patch text, not executable replacement content. */
  patch?: string;
  /** Writable managed skill agent document id. */
  skillDocumentId: string;
}

/** Input for consolidating managed skills into a canonical skill. */
export interface SkillConsolidateInput extends SkillBaseInput {
  /** Approval context that allows a consolidation mutation. */
  approval?: {
    /** Source of the approval decision. */
    source: 'proposal' | 'same_turn_feedback';
  };
  /** Full replacement Markdown body for the canonical skill. */
  bodyMarkdown?: string;
  /** Canonical writable managed skill agent document id. */
  canonicalSkillDocumentId: string;
  /** Optional description to persist with the canonical skill index. */
  description?: string;
  /** Source managed skill ids used to build the canonical skill. */
  sourceSkillIds: string[];
  /** Frozen source snapshots captured when the consolidation was proposed. */
  sourceSnapshots?: SkillTargetSnapshot[];
}

/** Frozen managed-skill target state used by approve-time consolidation preflight. */
export interface SkillTargetSnapshot {
  /** Managed skill bundle agent document id. */
  agentDocumentId?: string;
  /** Content hash observed when the proposal was created. */
  contentHash?: string;
  /** Canonical document id observed when the proposal was created. */
  documentId?: string;
  /** Whether the target was managed by Agent Signal. */
  managed?: boolean;
  /** Target domain captured by the proposal snapshot. */
  targetType?: 'skill';
  /** Whether the target was writable at proposal time. */
  writable?: boolean;
}

/** Request envelope for creating one skill. */
export interface SkillCreateRequest {
  /** Evidence supporting the skill creation. */
  evidenceRefs: EvidenceRef[];
  /** Stable action idempotency key. */
  idempotencyKey: string;
  /** Domain payload. */
  input: SkillCreateInput;
}

/** Request envelope for refining one skill. */
export interface SkillRefineRequest {
  /** Evidence supporting the refinement. */
  evidenceRefs: EvidenceRef[];
  /** Stable action idempotency key. */
  idempotencyKey: string;
  /** Domain payload. */
  input: SkillRefineInput;
}

/** Request envelope for consolidating managed skills. */
export interface SkillConsolidateRequest {
  /** Evidence supporting the consolidation. */
  evidenceRefs: EvidenceRef[];
  /** Stable action idempotency key. */
  idempotencyKey: string;
  /** Domain payload. */
  input: SkillConsolidateInput;
}

/** Result returned by skill adapters. */
export interface SkillResult {
  /** Affected writable managed skill document id. */
  skillDocumentId: string;
  /** Optional short persistence summary. */
  summary?: string;
}

/** Persistence adapters for managed skill operations. */
export interface SkillAdapters {
  /** Consolidates managed skills through the existing skill stack. */
  consolidateSkill?: (request: SkillConsolidateRequest) => Promise<SkillResult>;
  /** Creates managed skills through the existing skill stack. */
  createSkill?: (request: SkillCreateRequest) => Promise<SkillResult>;
  /** Refines managed skills through the existing skill stack. */
  refineSkill?: (request: SkillRefineRequest) => Promise<SkillResult>;
}

const assertSafeAutomaticMemory = (content: string) => {
  if (UNSAFE_AUTOMATIC_MEMORY_PATTERNS.some((pattern) => pattern.test(content))) {
    throw new Error('Memory candidate is not safe for automatic write');
  }
};

const assertWritableSkill = (targetReadonly: boolean | undefined) => {
  if (targetReadonly) {
    throw new Error('Skill target is readonly');
  }
};

const assertApprovedConsolidation = (input: SkillConsolidateInput) => {
  if (!input.approval) {
    throw new Error('Skill consolidation requires proposal or explicit same-turn approval');
  }
};

const assertCompleteRefineBody = (input: SkillRefineInput) => {
  if (!input.bodyMarkdown?.trim()) {
    throw new Error('Skill refinement requires a complete replacement bodyMarkdown');
  }
};

/**
 * Creates a memory service.
 *
 * Use when:
 * - Nightly self-review or self-reflection needs to write validated memory candidates
 * - Same-turn action handlers need a reusable validation boundary before persistence
 *
 * Expects:
 * - Server callers inject an adapter backed by the existing memory stack
 * - Planner has already decided the action may be attempted
 *
 * Returns:
 * - A service that validates automatic memory candidates before delegating persistence
 */
export const createMemoryService = (writer: MemoryWriter = {}) => ({
  writeMemory: async (request: MemoryWriteRequest): Promise<MemoryWriteResult> => {
    assertSafeAutomaticMemory(request.input.content);

    if (!writer.writeMemory) {
      throw new Error('Memory write adapter is required');
    }

    return writer.writeMemory({
      content: request.input.content,
      evidenceRefs: request.evidenceRefs,
      idempotencyKey: request.idempotencyKey,
      userId: request.input.userId,
    });
  },
});

/**
 * Creates a skill management service.
 *
 * Use when:
 * - Self-iteration executor needs one skill domain validation boundary
 * - Same-turn skill actions need to share target immutability and consolidation guards
 *
 * Expects:
 * - Builtin and marketplace skills are marked `targetReadonly` before mutation
 * - Server callers inject adapters backed by the existing managed-skill stack
 *
 * Returns:
 * - A service that validates skill targets before delegating persistence
 */
export const createSkillManagementService = (adapters: SkillAdapters = {}) => ({
  consolidateSkill: async (request: SkillConsolidateRequest): Promise<SkillResult> => {
    assertWritableSkill(request.input.targetReadonly);
    assertApprovedConsolidation(request.input);

    if (!adapters.consolidateSkill) {
      throw new Error('Skill consolidate adapter is required');
    }

    return adapters.consolidateSkill(request);
  },
  createSkill: async (request: SkillCreateRequest): Promise<SkillResult> => {
    assertWritableSkill(request.input.targetReadonly);

    if (!adapters.createSkill) {
      throw new Error('Skill create adapter is required');
    }

    return adapters.createSkill(request);
  },
  refineSkill: async (request: SkillRefineRequest): Promise<SkillResult> => {
    assertWritableSkill(request.input.targetReadonly);
    assertCompleteRefineBody(request.input);

    if (!adapters.refineSkill) {
      throw new Error('Skill refine adapter is required');
    }

    return adapters.refineSkill(request);
  },
});

/** Terminal status emitted by safe write tools. */
export type ToolWriteStatus =
  | 'applied'
  | 'deduped'
  | 'failed'
  | 'proposed'
  | 'skipped_stale'
  | 'skipped_unsupported';

/** Public result returned by safe write tools. */
export interface ToolWriteResult {
  /** Receipt written for the terminal tool outcome. */
  receiptId?: string;
  /** Resource touched or considered by the tool. */
  resourceId?: string;
  /** Terminal write safety status. */
  status: ToolWriteStatus;
  /** Bounded human-readable tool result. */
  summary?: string;
}

/** Successful preflight result for an existing-resource write targeting an existing resource. */
export interface ToolPreflightAllowed {
  /** Whether the target is still safe to mutate. */
  allowed: true;
}

/** Failed preflight result for an existing-resource write targeting an existing resource. */
export interface ToolPreflightDenied {
  /** Whether the target is still safe to mutate. */
  allowed: false;
  /** Short stale/conflict reason to store in the receipt. */
  reason: string;
}

/** Preflight result emitted before existing-resource writes. */
export type ToolPreflightResult = ToolPreflightAllowed | ToolPreflightDenied;

/** Write envelope accepted by all resource tools. */
export interface ToolWriteInput {
  /** Stable operation key used to dedupe repeated tool calls. */
  idempotencyKey: string;
  /** Stable proposal key used for proposal-scoped tracing and receipts. */
  proposalKey?: string;
  /** Optional caller-provided summary, bounded before persistence. */
  summary?: string;
  /** User that owns the resource operation. */
  userId: string;
}

/** Input for replacing one managed skill using compare-and-swap safety checks. */
export interface ReplaceSkillContentCASInput extends ToolWriteInput {
  /** Complete target snapshot captured when the proposal was created. */
  baseSnapshot?: SelfReviewProposalBaseSnapshot;
  /** Replacement skill body. */
  bodyMarkdown: string;
  /** Optional replacement description. */
  description?: string;
  /** Existing managed skill document id. */
  skillDocumentId: string;
}

/** Input for creating one skill when no existing skill has been selected. */
export interface CreateSkillIfAbsentInput extends ToolWriteInput {
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
export interface WriteMemoryInput extends ToolWriteInput {
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

/** Input for listing self-review proposals in one agent scope. */
export interface ListSelfReviewProposalsInput {
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

/** Input for creating one user-visible self-review proposal. */
export interface CreateSelfReviewProposalInput extends ToolWriteInput {
  /** Proposal action payload retained by the injected proposal adapter. */
  actions?: unknown[];
  /** Proposal metadata retained by the injected proposal adapter. */
  metadata?: Record<string, unknown>;
}

/** Input for refreshing an existing self-review proposal. */
export interface RefreshSelfReviewProposalInput extends ToolWriteInput {
  /** Existing proposal id to refresh. */
  proposalId: string;
}

/** Input for superseding an existing self-review proposal. */
export interface SupersedeSelfReviewProposalInput extends ToolWriteInput {
  /** Existing proposal id to supersede. */
  proposalId: string;
  /** Replacement proposal key or id. */
  supersededBy: string;
}

/** Input for closing an existing self-review proposal. */
export interface CloseSelfReviewProposalInput extends ToolWriteInput {
  /** Existing proposal id to close. */
  proposalId: string;
  /** Lifecycle reason recorded by the injected adapter. */
  reason?: string;
}

/** Result returned by mutation adapters before receipt persistence. */
export interface ToolMutationResult {
  /** Resource created or updated by the adapter. */
  resourceId?: string;
  /** Short adapter summary. */
  summary?: string;
}

/** Receipt write request emitted after every terminal write outcome. */
export interface ToolReceiptInput extends ToolWriteResult {
  /** Stable operation key used to dedupe repeated tool calls. */
  idempotencyKey: string;
  /** Stable proposal key used for proposal-scoped tracing and receipts. */
  proposalKey?: string;
  /** Tool that produced this receipt. */
  toolName: string;
  /** User that owns the resource operation. */
  userId: string;
}

/** Receipt adapter result. */
export interface ToolReceiptResult {
  /** Persisted receipt id. */
  receiptId?: string;
}

/** Lifecycle request emitted after a reserved resource operation reaches a terminal state. */
export interface OperationLifecycleInput extends ToolReceiptInput {
  /** Persisted terminal receipt id, when the receipt adapter returns one. */
  receiptId?: string;
}

/** Lifecycle request emitted when a reserved operation cannot write its terminal receipt. */
export interface OperationFailureInput extends ToolReceiptInput {
  /** Error thrown while writing the terminal receipt. */
  error: unknown;
}

/** Atomic reservation result for a newly claimed resource operation. */
export interface ReservedOperation {
  /** True when the adapter atomically claimed this idempotency key for mutation. */
  reserved: true;
}

/** Atomic reservation result for a previously completed resource operation. */
export interface ExistingOperation {
  /** Prior terminal operation result returned without running mutation. */
  existing: ToolWriteResult;
  /** False when the adapter found an existing terminal operation for this key. */
  reserved: false;
}

/** Atomic idempotency reservation emitted before any write preflight or mutation. */
export type OperationReservation = ExistingOperation | ReservedOperation;

/** Adapters used by safe read/write tools. */
export interface ToolSetAdapters {
  /** Closes an existing self-review proposal. */
  closeProposal?: (input: CloseSelfReviewProposalInput) => Promise<ToolMutationResult>;
  /**
   * Marks a reserved idempotency operation as terminal after its receipt is persisted.
   *
   * Adapters that store in-progress reservations should use this hook to make the terminal
   * receipt/result the dedupe source of truth. Without it, repeated calls may either rerun
   * mutation or leave reservations stuck in an in-progress state.
   */
  completeOperation?: (input: OperationLifecycleInput) => Promise<void>;
  /** Completes server-owned CAS metadata before validating an existing skill replacement. */
  completeReplaceSkillInput?: (
    input: ReplaceSkillContentCASInput,
  ) => Promise<ReplaceSkillContentCASInput>;
  /** Creates one user-visible self-review proposal. */
  createProposal?: (
    input: CreateSelfReviewProposalInput,
  ) => Promise<ToolMutationResult & { proposalId?: string }>;
  /** Creates one managed skill. */
  createSkill?: (input: CreateSkillIfAbsentInput) => Promise<ToolMutationResult>;
  /** Reads a bounded evidence digest for self-iteration planning. */
  getEvidenceDigest?: (input: GetEvidenceDigestInput) => Promise<unknown | undefined>;
  /** Reads one managed skill in the requested agent scope. */
  getManagedSkill?: (input: GetManagedSkillInput) => Promise<unknown | undefined>;
  /** Lists managed skills in the requested agent scope. */
  listManagedSkills?: (input: ListManagedSkillsInput) => Promise<unknown[]>;
  /** Lists self-review proposals in the requested agent scope. */
  listSelfReviewProposals?: (input: ListSelfReviewProposalsInput) => Promise<unknown[]>;
  /**
   * Marks or releases a reserved operation when its terminal receipt cannot be persisted.
   *
   * Adapters should make this hook prevent duplicate mutation while avoiding permanently stuck
   * reservations. A common implementation records the failure against the idempotency key and
   * releases retryable reservation state only when the mutation contract is safe to retry.
   */
  markOperationFailed?: (input: OperationFailureInput) => Promise<void>;
  /** Checks freshness and writability before mutating existing resources. */
  preflight?: (
    input:
      | CloseSelfReviewProposalInput
      | RefreshSelfReviewProposalInput
      | ReplaceSkillContentCASInput
      | SupersedeSelfReviewProposalInput,
  ) => Promise<ToolPreflightResult>;
  /** Reads an existing self-review proposal. */
  readProposal?: (input: {
    proposalId?: string;
    proposalKey?: string;
    userId: string;
  }) => Promise<unknown>;
  /** Refreshes an existing self-review proposal. */
  refreshProposal?: (input: RefreshSelfReviewProposalInput) => Promise<ToolMutationResult>;
  /** Replaces existing managed skill content after CAS preflight. */
  replaceSkill?: (input: ReplaceSkillContentCASInput) => Promise<ToolMutationResult>;
  /** Atomically reserves an idempotency key before any preflight or mutation runs. */
  reserveOperation: (idempotencyKey: string) => Promise<OperationReservation>;
  /** Supersedes an existing self-review proposal. */
  supersedeProposal?: (input: SupersedeSelfReviewProposalInput) => Promise<ToolMutationResult>;
  /** Writes one durable memory candidate. */
  writeMemory?: (input: WriteMemoryInput) => Promise<ToolMutationResult>;
  /** Writes the audit receipt for a terminal tool status. */
  writeReceipt: (input: ToolReceiptInput) => Promise<ToolReceiptResult>;
}

const MAX_SUMMARY_LENGTH = 240;

/**
 * Normalizes tool summaries.
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
): snapshot is SelfReviewProposalBaseSnapshot & {
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
  adapters: ToolSetAdapters,
  input: ToolWriteInput,
  toolName: string,
  result: ToolWriteResult,
): Promise<ToolWriteResult> => {
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

const withWriteSpan = async <TInput extends ToolWriteInput>(
  toolName: string,
  input: TInput,
  operation: (recordConvertedException: (error: unknown) => void) => Promise<ToolWriteResult>,
) => {
  return tracer.startActiveSpan(
    'agent_signal.self_iteration_tool.write',
    {
      attributes: {
        'agent.signal.self_iteration_tool.name': toolName,
        ...(input.proposalKey ? { 'agent.signal.proposal.key': input.proposalKey } : {}),
      },
    },
    async (span) => {
      try {
        const result = await operation((error) => span.recordException(error as Error));

        span.setAttribute('agent.signal.self_iteration_tool.write_status', result.status);
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
    'agent_signal.self_iteration_tool.read',
    {
      attributes: {
        'agent.signal.self_iteration_tool.name': toolName,
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

const runWriteTool = async <TInput extends ToolWriteInput>({
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
  adapters: ToolSetAdapters;
  input: TInput;
  mutate?: () => Promise<ToolMutationResult>;
  preflight?: () => Promise<ToolPreflightResult>;
  preflightRequired?: boolean;
  resourceId?: string;
  successStatus: Exclude<
    ToolWriteStatus,
    'deduped' | 'failed' | 'skipped_stale' | 'skipped_unsupported'
  >;
  toolName: string;
  unsupportedSummary: string;
  validate?: () => ToolWriteResult | undefined;
}) => {
  return withWriteSpan(toolName, input, async (recordConvertedException) => {
    let operationReserved = false;
    const result = await (async (): Promise<ToolWriteResult> => {
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
            summary: 'Tool preflight is not supported.',
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
 * Creates safe read/write resource tools with injected domain adapters.
 *
 * Use when:
 * - Agent Signal needs callable resource tools before runner wiring
 * - Tests need to verify write safety contracts without database services
 *
 * Expects:
 * - `idempotencyKey` is stable per intended write
 * - Existing-resource writes inject `preflight` before mutation
 *
 * Returns:
 * - Tool functions that dedupe, preflight, mutate, receipt, and trace consistently
 */
export const createToolSet = (adapters: ToolSetAdapters) => ({
  closeSelfReviewProposal: async (input: CloseSelfReviewProposalInput) =>
    runWriteTool({
      adapters,
      input,
      mutate: adapters.closeProposal ? () => adapters.closeProposal!(input) : undefined,
      preflight: adapters.preflight ? () => adapters.preflight!(input) : undefined,
      preflightRequired: true,
      resourceId: input.proposalId,
      successStatus: 'applied',
      toolName: 'closeSelfReviewProposal',
      unsupportedSummary: 'Self-review proposal close is not supported.',
    }),
  createSelfReviewProposal: async (input: CreateSelfReviewProposalInput) =>
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
      toolName: 'createSelfReviewProposal',
      unsupportedSummary: 'Self-review proposal creation is not supported.',
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
  listSelfReviewProposals: async (input: ListSelfReviewProposalsInput) =>
    withReadSpan('listSelfReviewProposals', undefined, async () => {
      if (!adapters.listSelfReviewProposals) return [];

      return adapters.listSelfReviewProposals(input);
    }),
  listManagedSkills: async (input: ListManagedSkillsInput) =>
    withReadSpan('listManagedSkills', undefined, async () => {
      if (!adapters.listManagedSkills) return [];

      return adapters.listManagedSkills(input);
    }),
  readSelfReviewProposal: async (input: {
    proposalId?: string;
    proposalKey?: string;
    userId: string;
  }) =>
    withReadSpan('readSelfReviewProposal', input.proposalKey, async () => {
      if (!adapters.readProposal) return undefined;

      return adapters.readProposal(input);
    }),
  refreshSelfReviewProposal: async (input: RefreshSelfReviewProposalInput) =>
    runWriteTool({
      adapters,
      input,
      mutate: adapters.refreshProposal ? () => adapters.refreshProposal!(input) : undefined,
      preflight: adapters.preflight ? () => adapters.preflight!(input) : undefined,
      preflightRequired: true,
      resourceId: input.proposalId,
      successStatus: 'proposed',
      toolName: 'refreshSelfReviewProposal',
      unsupportedSummary: 'Self-review proposal refresh is not supported.',
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
  supersedeSelfReviewProposal: async (input: SupersedeSelfReviewProposalInput) =>
    runWriteTool({
      adapters,
      input,
      mutate: adapters.supersedeProposal ? () => adapters.supersedeProposal!(input) : undefined,
      preflight: adapters.preflight ? () => adapters.preflight!(input) : undefined,
      preflightRequired: true,
      resourceId: input.proposalId,
      successStatus: 'applied',
      toolName: 'supersedeSelfReviewProposal',
      unsupportedSummary: 'Self-review proposal supersede is not supported.',
    }),
});

/** Callable safe resource tools exposed to bounded agent runners. */
export type ToolSet = ReturnType<typeof createToolSet>;

/**
 * Class-backed boundary for self-iteration resource tools.
 *
 * Use when:
 * - Review and reflection modes need the same dedupe, preflight, receipt, and tracing behavior
 * - Tests need one mockable collaborator instead of many function overrides
 *
 * Expects:
 * - Adapters are scoped to one user/agent boundary by the server runtime
 * - Existing-resource writes provide preflight where required
 *
 * Returns:
 * - A stable class surface that delegates to the safe write/read implementation
 */
export class ToolSetFacade {
  private readonly adapters: ToolSetAdapters;
  private readonly tools: ToolSet;

  constructor(adapters: ToolSetAdapters) {
    this.adapters = adapters;
    this.tools = createToolSet(adapters);
  }

  createSkillIfAbsent(input: CreateSkillIfAbsentInput) {
    return this.tools.createSkillIfAbsent(input);
  }

  replaceSkillContentCAS(input: ReplaceSkillContentCASInput) {
    return this.tools.replaceSkillContentCAS(input);
  }

  writeMemory(input: WriteMemoryInput) {
    return this.tools.writeMemory(input);
  }

  reserveOperation(idempotencyKey: string) {
    return this.adapters.reserveOperation(idempotencyKey);
  }

  completeOperation(input: OperationLifecycleInput) {
    return this.adapters.completeOperation?.(input) ?? Promise.resolve();
  }

  getEvidenceDigest(input: GetEvidenceDigestInput) {
    return this.tools.getEvidenceDigest(input);
  }

  getManagedSkill(input: GetManagedSkillInput) {
    return this.tools.getManagedSkill(input);
  }

  listManagedSkills(input: ListManagedSkillsInput) {
    return this.tools.listManagedSkills(input);
  }

  listSelfReviewProposals(input: ListSelfReviewProposalsInput) {
    return this.tools.listSelfReviewProposals(input);
  }

  readSelfReviewProposal(input: { proposalId?: string; proposalKey?: string; userId: string }) {
    return this.tools.readSelfReviewProposal(input);
  }

  createSelfReviewProposal(input: CreateSelfReviewProposalInput) {
    return this.tools.createSelfReviewProposal(input);
  }

  refreshSelfReviewProposal(input: RefreshSelfReviewProposalInput) {
    return this.tools.refreshSelfReviewProposal(input);
  }

  supersedeSelfReviewProposal(input: SupersedeSelfReviewProposalInput) {
    return this.tools.supersedeSelfReviewProposal(input);
  }

  closeSelfReviewProposal(input: CloseSelfReviewProposalInput) {
    return this.tools.closeSelfReviewProposal(input);
  }
}
