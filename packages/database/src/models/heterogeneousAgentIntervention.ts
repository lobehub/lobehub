import type {
  HeterogeneousAgentInterventionKind,
  HeterogeneousAgentInterventionProvider,
  HeterogeneousAgentInterventionResolutionPayload,
  HeterogeneousAgentInterventionReviewContext,
  HeterogeneousAgentInterventionSanitizedRequest,
  HeterogeneousAgentInterventionStatus,
} from '@lobechat/types';
import { and, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';

import type { HeterogeneousAgentInterventionItem } from '../schemas';
import { agentOperations, heterogeneousAgentInterventions } from '../schemas';
import type { LobeChatDatabase } from '../type';

export const HETERO_INTERVENTION_INVALID_REVIEW_TOKEN_HASH =
  'HETERO_INTERVENTION_INVALID_REVIEW_TOKEN_HASH';
export const HETERO_INTERVENTION_INVALID_PROVIDER_OPTIONS =
  'HETERO_INTERVENTION_INVALID_PROVIDER_OPTIONS';
export const HETERO_INTERVENTION_IDENTITY_CONFLICT = 'HETERO_INTERVENTION_IDENTITY_CONFLICT';
export const HETERO_INTERVENTION_RESOLUTION_REQUEST_REUSED =
  'HETERO_INTERVENTION_RESOLUTION_REQUEST_REUSED';

const REVIEW_TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const PG_UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (error: unknown): boolean =>
  !!error &&
  typeof error === 'object' &&
  (('code' in error && (error as { code?: string }).code === PG_UNIQUE_VIOLATION) ||
    ('cause' in error && isUniqueViolation((error as { cause?: unknown }).cause)));

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const hasValidProviderOptions = (
  request: HeterogeneousAgentInterventionSanitizedRequest,
): boolean => {
  if (request.questions?.length !== 1) return false;

  const [question] = request.questions;
  const optionIds = question.options.map((option) => option.id);
  return (
    question.multiSelect !== true &&
    question.question.length > 0 &&
    optionIds.length > 0 &&
    optionIds.every((id): id is string => typeof id === 'string' && id.length > 0) &&
    new Set(optionIds).size === optionIds.length
  );
};

const hasExactProviderResolution = (
  request: HeterogeneousAgentInterventionSanitizedRequest,
  payload: HeterogeneousAgentInterventionResolutionPayload,
): boolean => {
  if (payload.cancelled) {
    return payload.cancelReason === 'user_cancelled' && payload.result === undefined;
  }

  const result = asRecord(payload.result);
  if (!result || request.questions?.length !== 1) return false;

  const [question] = request.questions;
  const resultKeys = Object.keys(result);
  const rawSelection = result[question.question];
  const allowedIds = new Set(question.options.map((option) => option.id));
  return (
    resultKeys.length === 1 &&
    resultKeys[0] === question.question &&
    typeof rawSelection === 'string' &&
    allowedIds.has(rawSelection)
  );
};

export interface CreateHeterogeneousAgentInterventionParams {
  deadline: Date;
  interactionKind: HeterogeneousAgentInterventionKind;
  operationId: string;
  provider: HeterogeneousAgentInterventionProvider;
  reviewContext: HeterogeneousAgentInterventionReviewContext;
  reviewTokenHash: string;
  sanitizedRequest: HeterogeneousAgentInterventionSanitizedRequest;
  toolCallId: string;
}

export type HeterogeneousAgentInterventionMutationResult =
  | {
      intervention: HeterogeneousAgentInterventionItem;
      outcome: 'applied' | 'idempotent';
    }
  | {
      intervention?: HeterogeneousAgentInterventionItem;
      outcome: 'conflict' | 'not_found';
    };

/**
 * Owner-scoped state machine for durable heterogeneous-agent callbacks.
 *
 * `claim` is the first-winner write. It persists the user's exact response but
 * leaves the row in `resolving`; only `acknowledgeResolution` may expose a
 * successful terminal state, after the blocked CLI callback confirms it
 * consumed that response. If Redis publication fails before consumption,
 * `rollbackClaim` conditionally returns only that request id to `pending`.
 */
export class HeterogeneousAgentInterventionModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    and(
      eq(heterogeneousAgentInterventions.userId, this.userId),
      this.workspaceId
        ? eq(heterogeneousAgentInterventions.workspaceId, this.workspaceId)
        : isNull(heterogeneousAgentInterventions.workspaceId),
    );

  private ownerOnly = () => eq(heterogeneousAgentInterventions.userId, this.userId);

  /** Idempotent on the producer correlation key `(operationId, toolCallId)`. */
  create = async (
    params: CreateHeterogeneousAgentInterventionParams,
  ): Promise<HeterogeneousAgentInterventionItem> => {
    if (!REVIEW_TOKEN_HASH_PATTERN.test(params.reviewTokenHash)) {
      throw new Error(HETERO_INTERVENTION_INVALID_REVIEW_TOKEN_HASH);
    }
    if (
      params.interactionKind !== 'question' &&
      !hasValidProviderOptions(params.sanitizedRequest)
    ) {
      throw new Error(HETERO_INTERVENTION_INVALID_PROVIDER_OPTIONS);
    }

    const [ownedOperation] = await this.db
      .select({ id: agentOperations.id })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.id, params.operationId),
          eq(agentOperations.userId, this.userId),
          this.workspaceId
            ? eq(agentOperations.workspaceId, this.workspaceId)
            : isNull(agentOperations.workspaceId),
        ),
      )
      .limit(1);
    if (!ownedOperation) throw new Error(HETERO_INTERVENTION_IDENTITY_CONFLICT);

    const [created] = await this.db
      .insert(heterogeneousAgentInterventions)
      .values({
        ...params,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoNothing({
        target: [
          heterogeneousAgentInterventions.operationId,
          heterogeneousAgentInterventions.toolCallId,
        ],
      })
      .returning();

    if (created) return created;

    // A repeated producer event gets the original durable row (and therefore
    // the original Review token/request). A cross-owner collision must not
    // disclose that row, even though operation ids are expected to be global.
    const existing = await this.reloadByOperationAndToolCall(params.operationId, params.toolCallId);
    if (existing) return this.withLazyTimeout(existing);

    throw new Error(HETERO_INTERVENTION_IDENTITY_CONFLICT);
  };

  findById = async (id: string): Promise<HeterogeneousAgentInterventionItem | undefined> => {
    const row = await this.reload(id);
    return row && this.withLazyTimeout(row);
  };

  /**
   * Owner-only cold-start lookup by durable intervention id.
   *
   * ActivityKit can rotate and upload its per-activity update token before the
   * app has restored the workspace header. This lookup intentionally spans
   * workspaces for the authenticated owner so the Cloud caller can rebuild a
   * workspace-scoped model before validating the operation and writing the
   * token. The id is a locator, never standalone authority.
   */
  findByIdForOwner = async (
    id: string,
  ): Promise<HeterogeneousAgentInterventionItem | undefined> => {
    if (!UUID_PATTERN.test(id)) return undefined;

    const [row] = await this.db
      .select()
      .from(heterogeneousAgentInterventions)
      .where(and(eq(heterogeneousAgentInterventions.id, id), this.ownerOnly()))
      .limit(1);

    return row && this.withLazyTimeout(row);
  };

  /**
   * Cold-start Review lookup by a SHA-256 locator digest. The raw token is
   * hashed before entering this model and is never persisted or logged. This
   * query still requires the authenticated owner, but intentionally spans
   * workspaces because a Universal Link cold start has no workspace header.
   */
  findByReviewTokenHash = async (
    reviewTokenHash: string,
  ): Promise<HeterogeneousAgentInterventionItem | undefined> => {
    if (!REVIEW_TOKEN_HASH_PATTERN.test(reviewTokenHash)) return undefined;

    const [row] = await this.db
      .select()
      .from(heterogeneousAgentInterventions)
      .where(
        and(eq(heterogeneousAgentInterventions.reviewTokenHash, reviewTokenHash), this.ownerOnly()),
      )
      .limit(1);

    return row && this.withLazyTimeout(row);
  };

  findByOperationAndToolCall = async (
    operationId: string,
    toolCallId: string,
  ): Promise<HeterogeneousAgentInterventionItem | undefined> => {
    const row = await this.reloadByOperationAndToolCall(operationId, toolCallId);
    return row && this.withLazyTimeout(row);
  };

  /**
   * Atomically wins a pending request. The client UUID is globally unique and
   * retained on the row: the same request can retry idempotently, while a
   * different Web/Mobile/device request sees `conflict` plus current state.
   */
  claim = async (
    id: string,
    params: {
      resolutionPayload: HeterogeneousAgentInterventionResolutionPayload;
      resolutionRequestId: string;
    },
  ): Promise<HeterogeneousAgentInterventionMutationResult> => {
    const scopedRow = await this.reload(id);
    if (
      scopedRow &&
      scopedRow.interactionKind !== 'question' &&
      !hasExactProviderResolution(scopedRow.sanitizedRequest, params.resolutionPayload)
    ) {
      throw new Error(HETERO_INTERVENTION_INVALID_PROVIDER_OPTIONS);
    }

    const now = new Date();

    try {
      const [claimed] = await this.db
        .update(heterogeneousAgentInterventions)
        .set({
          resolutionActorId: this.userId,
          resolutionPayload: params.resolutionPayload,
          resolutionRequestId: params.resolutionRequestId,
          resolvingAt: now,
          status: 'resolving',
          updatedAt: now,
          version: sql`${heterogeneousAgentInterventions.version} + 1`,
        })
        .where(
          and(
            eq(heterogeneousAgentInterventions.id, id),
            this.ownership(),
            eq(heterogeneousAgentInterventions.status, 'pending'),
            gt(heterogeneousAgentInterventions.deadline, now),
          ),
        )
        .returning();

      if (claimed) return { intervention: claimed, outcome: 'applied' };
    } catch (error) {
      // Reusing one client UUID for a different intervention is a suspicious
      // replay, not an ordinary loser in the same row's first-winner race.
      if (isUniqueViolation(error)) {
        throw new Error(HETERO_INTERVENTION_RESOLUTION_REQUEST_REUSED, { cause: error });
      }
      throw error;
    }

    const current = await this.reloadAndTimeout(id, now);
    if (!current) return { outcome: 'not_found' };
    if (
      current.resolutionRequestId === params.resolutionRequestId &&
      current.status !== 'pending'
    ) {
      return { intervention: current, outcome: 'idempotent' };
    }
    return { intervention: current, outcome: 'conflict' };
  };

  /**
   * Redis publish failed before producer consumption. Only the request that
   * currently owns `resolving` may roll itself back; a stale failure can never
   * reopen another device's claim or an acknowledged terminal row.
   */
  rollbackClaim = async (
    id: string,
    resolutionRequestId: string,
  ): Promise<HeterogeneousAgentInterventionMutationResult> => {
    const now = new Date();
    const [rolledBack] = await this.db
      .update(heterogeneousAgentInterventions)
      .set({
        resolutionActorId: null,
        resolutionPayload: null,
        resolutionRequestId: null,
        resolvingAt: null,
        status: 'pending',
        updatedAt: now,
        version: sql`${heterogeneousAgentInterventions.version} + 1`,
      })
      .where(
        and(
          eq(heterogeneousAgentInterventions.id, id),
          this.ownership(),
          eq(heterogeneousAgentInterventions.status, 'resolving'),
          eq(heterogeneousAgentInterventions.resolutionRequestId, resolutionRequestId),
          gt(heterogeneousAgentInterventions.deadline, now),
        ),
      )
      .returning();

    if (rolledBack) return { intervention: rolledBack, outcome: 'applied' };

    const current = await this.reloadAndTimeout(id, now);
    if (!current) return { outcome: 'not_found' };
    // Already pending is the desired rollback state. No request data is kept
    // there by design, so repeated rollback is a harmless idempotent no-op.
    if (current.status === 'pending') return { intervention: current, outcome: 'idempotent' };
    return { intervention: current, outcome: 'conflict' };
  };

  /**
   * Producer ACK is the success boundary. The guarded update both records the
   * ACK and moves the winning request to its user-facing terminal state.
   */
  acknowledgeResolution = async (
    id: string,
    params: {
      producerAckAt?: Date;
      resolutionRequestId: string;
      status: 'cancelled' | 'resolved';
    },
  ): Promise<HeterogeneousAgentInterventionMutationResult> => {
    const producerAckAt = params.producerAckAt ?? new Date();
    const [acknowledged] = await this.db
      .update(heterogeneousAgentInterventions)
      .set({
        producerAckAt,
        resolvedAt: producerAckAt,
        status: params.status,
        updatedAt: producerAckAt,
        version: sql`${heterogeneousAgentInterventions.version} + 1`,
      })
      .where(
        and(
          eq(heterogeneousAgentInterventions.id, id),
          this.ownership(),
          eq(heterogeneousAgentInterventions.status, 'resolving'),
          eq(heterogeneousAgentInterventions.resolutionRequestId, params.resolutionRequestId),
        ),
      )
      .returning();

    if (acknowledged) return { intervention: acknowledged, outcome: 'applied' };

    const current = await this.reload(id);
    if (!current) return { outcome: 'not_found' };
    if (
      current.resolutionRequestId === params.resolutionRequestId &&
      current.status === params.status &&
      current.producerAckAt
    ) {
      return { intervention: current, outcome: 'idempotent' };
    }
    return { intervention: current, outcome: 'conflict' };
  };

  /** Deadline expiry or producer/session teardown, conditional on still-open state. */
  markTerminal = async (
    id: string,
    params: {
      producerAckAt?: Date;
      status: 'session_ended' | 'timed_out';
    },
  ): Promise<HeterogeneousAgentInterventionMutationResult> => {
    const now = params.producerAckAt ?? new Date();
    const terminalCondition =
      params.status === 'timed_out'
        ? lte(heterogeneousAgentInterventions.deadline, now)
        : sql`true`;

    const [terminal] = await this.db
      .update(heterogeneousAgentInterventions)
      .set({
        producerAckAt: params.producerAckAt,
        resolvedAt: now,
        status: params.status,
        updatedAt: now,
        version: sql`${heterogeneousAgentInterventions.version} + 1`,
      })
      .where(
        and(
          eq(heterogeneousAgentInterventions.id, id),
          this.ownership(),
          inArray(heterogeneousAgentInterventions.status, ['pending', 'resolving']),
          terminalCondition,
        ),
      )
      .returning();

    if (terminal) return { intervention: terminal, outcome: 'applied' };

    const current = await this.reload(id);
    if (!current) return { outcome: 'not_found' };
    if (current.status === params.status) return { intervention: current, outcome: 'idempotent' };
    return { intervention: current, outcome: 'conflict' };
  };

  /** Record a late producer terminal ACK without changing its authoritative outcome. */
  recordProducerAck = async (
    id: string,
    producerAckAt = new Date(),
  ): Promise<HeterogeneousAgentInterventionMutationResult> => {
    const [acknowledged] = await this.db
      .update(heterogeneousAgentInterventions)
      .set({
        producerAckAt,
        updatedAt: producerAckAt,
        version: sql`${heterogeneousAgentInterventions.version} + 1`,
      })
      .where(
        and(
          eq(heterogeneousAgentInterventions.id, id),
          this.ownership(),
          inArray(heterogeneousAgentInterventions.status, [
            'resolved',
            'cancelled',
            'timed_out',
            'session_ended',
          ]),
          isNull(heterogeneousAgentInterventions.producerAckAt),
        ),
      )
      .returning();

    if (acknowledged) return { intervention: acknowledged, outcome: 'applied' };

    const current = await this.reload(id);
    if (!current) return { outcome: 'not_found' };
    if (current.producerAckAt) return { intervention: current, outcome: 'idempotent' };
    return { intervention: current, outcome: 'conflict' };
  };

  private reload = async (id: string): Promise<HeterogeneousAgentInterventionItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(heterogeneousAgentInterventions)
      .where(and(eq(heterogeneousAgentInterventions.id, id), this.ownership()))
      .limit(1);
    return row;
  };

  private reloadByOperationAndToolCall = async (
    operationId: string,
    toolCallId: string,
  ): Promise<HeterogeneousAgentInterventionItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(heterogeneousAgentInterventions)
      .where(
        and(
          eq(heterogeneousAgentInterventions.operationId, operationId),
          eq(heterogeneousAgentInterventions.toolCallId, toolCallId),
          this.ownership(),
        ),
      )
      .limit(1);
    return row;
  };

  private reloadAndTimeout = async (
    id: string,
    now: Date,
  ): Promise<HeterogeneousAgentInterventionItem | undefined> => {
    const row = await this.reload(id);
    return row && this.withLazyTimeout(row, now);
  };

  private withLazyTimeout = async (
    row: HeterogeneousAgentInterventionItem,
    now = new Date(),
  ): Promise<HeterogeneousAgentInterventionItem> => {
    if (
      !(['pending', 'resolving'] as HeterogeneousAgentInterventionStatus[]).includes(row.status) ||
      row.deadline.getTime() > now.getTime()
    ) {
      return row;
    }

    const [timedOut] = await this.db
      .update(heterogeneousAgentInterventions)
      .set({
        resolvedAt: now,
        status: 'timed_out',
        updatedAt: now,
        version: sql`${heterogeneousAgentInterventions.version} + 1`,
      })
      .where(
        and(
          eq(heterogeneousAgentInterventions.id, row.id),
          this.ownerOnly(),
          inArray(heterogeneousAgentInterventions.status, ['pending', 'resolving']),
          lte(heterogeneousAgentInterventions.deadline, now),
        ),
      )
      .returning();

    return timedOut ?? (await this.reloadOwnerOnly(row.id)) ?? row;
  };

  private reloadOwnerOnly = async (
    id: string,
  ): Promise<HeterogeneousAgentInterventionItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(heterogeneousAgentInterventions)
      .where(and(eq(heterogeneousAgentInterventions.id, id), this.ownerOnly()))
      .limit(1);
    return row;
  };
}
