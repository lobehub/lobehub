import { AgentInterventionRepository } from '../../repositories/agentIntervention';
import type { AgentInterventionItem, AgentInterventionResolutionItem } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type { AgentInterventionContext } from './context';
import * as creation from './creation';
import * as customExecution from './customExecution';
import * as locate from './locate';
import * as lookup from './lookup';
import * as resolution from './resolution';
import type {
  AgentInterventionBatchMutationResult,
  AgentInterventionBatchState,
  AgentInterventionBatchSupersessionResult,
  AgentInterventionCustomExecutionClaimResult,
  AgentInterventionCustomExecutionCompletionResult,
  AgentInterventionLocator,
  AgentInterventionResolutionLocator,
  ClaimAgentInterventionBatchParams,
  ClaimAgentInterventionCustomExecutionParams,
  CompleteAgentInterventionCustomExecutionParams,
  CreateAgentInterventionBatchParams,
  CreateAgentInterventionBatchWithSupersessionParams,
} from './types';

export {
  AGENT_INTERVENTION_CUSTOM_EXECUTION_MAX_LEASE_MS,
  AGENT_INTERVENTION_CUSTOM_EXECUTION_MIN_LEASE_MS,
  AGENT_INTERVENTION_IDENTITY_CONFLICT,
  AGENT_INTERVENTION_INVALID_ACTION,
  AGENT_INTERVENTION_INVALID_BATCH,
  AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH,
  AGENT_INTERVENTION_INVALID_REVIEW_TOKEN_HASH,
  AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED,
  AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH,
} from './constants';
export type {
  AgentInterventionBatchMutationResult,
  AgentInterventionBatchState,
  AgentInterventionBatchSupersession,
  AgentInterventionBatchSupersessionResult,
  AgentInterventionCustomExecutionClaimResult,
  AgentInterventionCustomExecutionCompletionResult,
  AgentInterventionLocator,
  AgentInterventionResolutionLocator,
  AgentInterventionResolutionPublicItem,
  ClaimAgentInterventionBatchParams,
  ClaimAgentInterventionCustomExecutionParams,
  CompleteAgentInterventionCustomExecutionParams,
  CreateAgentInterventionBatchParams,
  CreateAgentInterventionBatchWithSupersessionParams,
  CreateAgentInterventionItemParams,
} from './types';
export { hashAgentInterventionRequestRevision } from './utils';

export class AgentInterventionModel {
  /** The scope handed to the helper modules in this directory. */
  private readonly ctx: AgentInterventionContext;

  /**
   * Owns the flows that also write other aggregates (agent operations, tool
   * messages, user settings). The methods below that delegate to it are kept so
   * existing callers of this model keep working; new code should use
   * `AgentInterventionRepository` directly.
   */
  private readonly repository: AgentInterventionRepository;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.ctx = { db, userId, workspaceId };
    this.repository = new AgentInterventionRepository(db, userId, workspaceId);
  }

  /**
   * System-only locator. It returns only routing/ACL context and never exposes
   * render content, action capability, token hash, or resolution payload.
   */
  static locateByReviewTokenHash = (
    db: LobeChatDatabase,
    reviewTokenHash: string,
  ): Promise<AgentInterventionLocator | undefined> =>
    locate.locateByReviewTokenHash(db, reviewTokenHash);

  /**
   * System-only compatibility locator for authenticated in-conversation
   * actions. The correlation pair is not authority: callers must still load
   * the owning operation, apply resource ACL, and then rebuild the
   * owner/workspace-scoped model before reading or claiming the batch.
   *
   * Use when:
   * - Resolving an authenticated callback without a review token.
   *
   * Expects:
   * - Batch or callback identity when an operation/tool pair has multiple rows.
   *
   * Returns:
   * - The exact locator, undefined if absent, or an error for ambiguous legacy input.
   * - Never substitutes a newer pending batch for an older client action.
   */
  static locateByOperationAndToolCall = (
    db: LobeChatDatabase,
    operationId: string,
    toolCallId: string,
    callback?: { batchId?: string; interventionId?: string },
  ): Promise<AgentInterventionLocator | undefined> =>
    locate.locateByOperationAndToolCall(db, operationId, toolCallId, callback);

  /** System-only owner/workspace recovery for post-claim delivery callbacks. */
  static locateByResolutionRequestId = (
    db: LobeChatDatabase,
    resolutionRequestId: string,
  ): Promise<AgentInterventionResolutionLocator | undefined> =>
    locate.locateByResolutionRequestId(db, resolutionRequestId);

  /**
   * Atomically claims a short custom-execution lease without holding a database
   * transaction across the external side effect. A completed claim replays the
   * exact durable private result; a live lease never exposes its fencing token.
   */
  claimCustomExecution = (
    params: ClaimAgentInterventionCustomExecutionParams,
    now = new Date(),
  ): Promise<AgentInterventionCustomExecutionClaimResult> =>
    customExecution.claimCustomExecution(this.ctx, params, now);

  /** Completes only the exact current fencing token and replays exact retries. */
  completeCustomExecution = (
    params: CompleteAgentInterventionCustomExecutionParams,
    now = new Date(),
  ): Promise<AgentInterventionCustomExecutionCompletionResult> =>
    customExecution.completeCustomExecution(this.ctx, params, now);

  /** Creates and seals a complete batch in one transaction. */
  createBatch = (params: CreateAgentInterventionBatchParams): Promise<AgentInterventionItem[]> =>
    creation.createBatch(this.ctx, params);

  /**
   * Atomically replaces the still-pending remainder of a runtime batch after a
   * partial decision re-parks under a new operation. The new parked batch is
   * causal proof that the prior runtime continuation started, so an in-flight
   * winning resolution may be completed here before its published hook arrives.
   */
  createBatchWithSupersession = (
    params: CreateAgentInterventionBatchWithSupersessionParams,
  ): Promise<AgentInterventionBatchSupersessionResult> =>
    this.repository.createBatchWithSupersession(params);

  findById = (id: string): Promise<AgentInterventionItem | undefined> =>
    lookup.findById(this.ctx, id);

  /** Owner-only cold-start lookup used before restoring a workspace header. */
  findByIdForOwner = (id: string): Promise<AgentInterventionItem | undefined> =>
    lookup.findByIdForOwner(this.ctx, id);

  /** Legacy owner-auth token lookup. Workspace collaborators use the system locator + ACL. */
  findByReviewTokenHash = (reviewTokenHash: string): Promise<AgentInterventionItem | undefined> =>
    lookup.findByReviewTokenHash(this.ctx, reviewTokenHash);

  findBatch = (operationId: string, batchId: string): Promise<AgentInterventionBatchState> =>
    lookup.findBatch(this.ctx, operationId, batchId);

  /**
   * Atomically validates a complete sealed Review snapshot and claims one,
   * selected, or all pending items. The resolving actor is explicit and may be
   * different from the operation owner after the service has applied ACL.
   */
  claimBatch = (
    params: ClaimAgentInterventionBatchParams,
  ): Promise<AgentInterventionBatchMutationResult> => this.repository.claimBatch(params);

  markResolutionPublished = (
    resolutionRequestId: string,
    publishedAt = new Date(),
  ): Promise<AgentInterventionBatchMutationResult> =>
    resolution.markResolutionPublished(this.ctx, resolutionRequestId, publishedAt);

  /** Publish failed before consumption; conditionally reopens only this claim. */
  rollbackResolution = (
    resolutionRequestId: string,
  ): Promise<AgentInterventionBatchMutationResult> =>
    this.repository.rollbackResolution(resolutionRequestId);

  /** Runtime rows become terminal once the continuation has durably started. */
  completeRuntimeResolution = (
    resolutionRequestId: string,
    continuationStartedAt = new Date(),
  ): Promise<AgentInterventionBatchMutationResult> =>
    this.repository.completeRuntimeResolution(resolutionRequestId, continuationStartedAt);

  /** Heterogeneous rows become terminal only after the matching producer ACK. */
  acknowledgeProducerResolution = (
    resolutionRequestId: string,
    producerAckAt = new Date(),
  ): Promise<AgentInterventionBatchMutationResult> =>
    this.repository.acknowledgeProducerResolution(resolutionRequestId, producerAckAt);

  /** Timeout/session teardown of every still-open item in one sealed batch. */
  markBatchTerminal = (
    operationId: string,
    batchId: string,
    status: 'session_ended' | 'timed_out',
    at = new Date(),
  ): Promise<AgentInterventionItem[]> =>
    lookup.markBatchTerminal(this.ctx, operationId, batchId, status, at);

  /** Late heterogeneous ACK is audited without overwriting timeout/session outcome. */
  recordProducerAck = (
    resolutionRequestId: string,
    producerAckAt = new Date(),
  ): Promise<AgentInterventionBatchMutationResult> =>
    resolution.recordProducerAck(this.ctx, resolutionRequestId, producerAckAt);

  findResolutionByRequestId = (
    resolutionRequestId: string,
  ): Promise<AgentInterventionResolutionItem | undefined> =>
    resolution.findResolutionByRequestId(this.ctx, resolutionRequestId);
}
