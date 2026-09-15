import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';

import type {
  DocumentRewriteProgress,
  DocumentRewriteProgressEvent,
  DocumentRewriteProgressStage,
  DocumentRewriteRequestItem,
  DocumentRewriteRequestStatus,
  DocumentRewriteSelection,
  NewDocumentRewriteRequest,
} from '../schemas';
import {
  agents,
  DOCUMENT_REWRITE_PROGRESS_DETAIL_MAX_LENGTH,
  DOCUMENT_REWRITE_PROGRESS_MAX_EVENTS,
  DOCUMENT_REWRITE_PROGRESS_STAGES,
  DOCUMENT_REWRITE_PROGRESS_SUMMARY_MAX_LENGTH,
  DOCUMENT_REWRITE_PROGRESS_TOOL_MAX_LENGTH,
  DOCUMENT_REWRITE_PROGRESS_TOOLS,
  documentCollaborationStates,
  documentHistories,
  documentRewriteRequests,
  documents,
  topics,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { idGenerator } from '../utils/idGenerator';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { documentRewriteSelectionsOverlap } from './documentRewriteRequest.overlap';
import {
  collectAIBlockSessionProjection,
  collectAIRequestProjection,
  collectAISessionProjection,
  DOCUMENT_REWRITE_INSTRUCTION_MAX_LENGTH,
  DOCUMENT_REWRITE_REQUEST_INVALID,
  DOCUMENT_REWRITE_SESSION_MAX_LENGTH,
  hashRewriteText,
  isUniqueViolation,
  jsonEqual,
  normalizeRewriteText,
  normalizeSelection,
  normalizeString,
  resolvePersistedBlockRewriteContext,
  safeLeaseMs,
  targetKeyFromNodeIds,
  targetNodeIdsFromSelection,
} from './documentRewriteRequest.validation';
import {
  assertDocumentRewriteTransition,
  canRetryDocumentRewrite,
  DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES,
  isDocumentRewriteTerminal,
} from './documentRewriteRequestState';

export {
  type DocumentRewriteOverlapCandidate,
  documentRewriteSelectionsOverlap,
} from './documentRewriteRequest.overlap';

export const DOCUMENT_REWRITE_REQUEST_NOT_FOUND = 'DOCUMENT_REWRITE_REQUEST_NOT_FOUND';
export const DOCUMENT_REWRITE_REQUEST_CONFLICT = 'DOCUMENT_REWRITE_REQUEST_CONFLICT';
/** Stable error returned when a document already has five held rewrite rows. */
export const DOCUMENT_REWRITE_ACTIVE_LIMIT = 'DOCUMENT_REWRITE_ACTIVE_LIMIT';
/** Alias used by callers that describe the same guard as a concurrency limit. */
export const DOCUMENT_REWRITE_CONCURRENCY_LIMIT = DOCUMENT_REWRITE_ACTIVE_LIMIT;
export const DOCUMENT_REWRITE_CAPACITY_EXCEEDED = DOCUMENT_REWRITE_ACTIVE_LIMIT;
export const DOCUMENT_REWRITE_MAX_ACTIVE_REQUESTS = 5;
export const DOCUMENT_REWRITE_MAX_CONCURRENT_REQUESTS = DOCUMENT_REWRITE_MAX_ACTIVE_REQUESTS;
export const DOCUMENT_REWRITE_REQUEST_EXPIRED = 'DOCUMENT_REWRITE_REQUEST_EXPIRED';
export const DOCUMENT_REWRITE_REQUEST_NOT_CLAIMED = 'DOCUMENT_REWRITE_REQUEST_NOT_CLAIMED';
export const DOCUMENT_REWRITE_REVIEW_PROOF_INVALID = 'DOCUMENT_REWRITE_REVIEW_PROOF_INVALID';
/** The persisted document no longer contains the applied session output. */
export const DOCUMENT_REWRITE_CONTINUATION_DELETED = 'DOCUMENT_REWRITE_CONTINUATION_DELETED';
/** The persisted document contains a changed version of the applied output. */
export const DOCUMENT_REWRITE_CONTINUATION_CHANGED = 'DOCUMENT_REWRITE_CONTINUATION_CHANGED';
/** The direct command was observed, but its room projection is not durable yet. */
export const DOCUMENT_REWRITE_DIRECT_PERSISTENCE_PENDING =
  'DOCUMENT_REWRITE_DIRECT_PERSISTENCE_PENDING';
/** A direct applied transition was attempted without a valid durable proof. */
export const DOCUMENT_REWRITE_DIRECT_APPLY_PROOF_INVALID =
  'DOCUMENT_REWRITE_DIRECT_APPLY_PROOF_INVALID';
export const DOCUMENT_REWRITE_REVIEW_SWEEP_DEFAULT_MAX_AGE_MS = 15 * 60_000;
/** Topic trigger used for the durable, hidden conversation backing rewrites. */
export const DOCUMENT_REWRITE_TOPIC_TRIGGER = 'document_rewrite';

export {
  DOCUMENT_REWRITE_ADAPTER_ID_MAX_LENGTH,
  DOCUMENT_REWRITE_DEFAULT_LEASE_MS,
  DOCUMENT_REWRITE_ERROR_MAX_LENGTH,
  DOCUMENT_REWRITE_INSTRUCTION_MAX_LENGTH,
  DOCUMENT_REWRITE_MAX_LEASE_MS,
  DOCUMENT_REWRITE_QUOTED_TEXT_MAX_LENGTH,
  DOCUMENT_REWRITE_REQUEST_INVALID,
  DOCUMENT_REWRITE_SELECTION_MAX_ARRAY_LENGTH,
  DOCUMENT_REWRITE_SELECTION_MAX_BYTES,
  DOCUMENT_REWRITE_SELECTION_MAX_DEPTH,
  DOCUMENT_REWRITE_SELECTION_MAX_KEYS,
  DOCUMENT_REWRITE_SESSION_MAX_LENGTH,
  DOCUMENT_REWRITE_SOURCE_HASH_MAX_LENGTH,
  DOCUMENT_REWRITE_TARGET_KEY_MAX_LENGTH,
  DOCUMENT_REWRITE_TARGET_NODE_IDS_MAX_LENGTH,
  DOCUMENT_REWRITE_WHOLE_DOCUMENT_TARGET,
  normalizeSelection,
} from './documentRewriteRequest.validation';

/** States that keep the target reservation until the request is terminal. */
export const DOCUMENT_REWRITE_TARGET_HOLD_STATUSES = [
  'queued',
  'connecting',
  'syncing',
  'thinking',
  'writing',
  'awaiting_review',
  'cancel_requested',
  'canceled_after_write',
  'retry_wait',
] as const;

/**
 * States that consume one of the five concurrent Agent slots. Legacy review
 * rows intentionally remain target-held but do not consume a running Agent
 * slot, otherwise old awaiting_review data could block new work forever.
 */
export const DOCUMENT_REWRITE_REQUEST_CAPACITY_STATUSES = [
  'queued',
  'connecting',
  'syncing',
  'thinking',
  'writing',
  'cancel_requested',
  'retry_wait',
] as const;

/** Compatibility name used by capacity/recovery callers. */
export const DOCUMENT_REWRITE_CAPACITY_STATUSES = DOCUMENT_REWRITE_REQUEST_CAPACITY_STATUSES;
export const DOCUMENT_REWRITE_REQUEST_HOLD_STATUSES = DOCUMENT_REWRITE_TARGET_HOLD_STATUSES;

/**
 * A terminal turn that did not produce a usable successor may be skipped when
 * continuing from the last applied parent. Applied, review-pending, and all
 * target-holding/active rows remain hard stops.
 */
const DOCUMENT_REWRITE_CONTINUATION_SKIPPABLE_STATUSES = [
  'failed',
  'stale',
  'canceled',
  'canceled_after_write',
  'rejected',
] as const satisfies readonly DocumentRewriteRequestStatus[];

const canContinuePastLatestTurn = (status: DocumentRewriteRequestStatus): boolean =>
  DOCUMENT_REWRITE_CONTINUATION_SKIPPABLE_STATUSES.includes(status as never);

/** Exclude the server-owned post-apply proof from create idempotency identity. */
const selectionForRequestIdentity = (
  selection: DocumentRewriteSelection,
): DocumentRewriteSelection => {
  const identity = { ...selection };
  delete identity.appliedTextHash;
  return identity;
};

export interface CreateDocumentRewriteRequestInput {
  agentId: string;
  documentId: string;
  expiresAt?: Date;
  id?: string;
  instruction: string;
  /** Optional per-turn model override; never mutates the Agent default. */
  model?: string | null;
  operationId?: string | null;
  /** Internal continuation linkage; never accepted from the public create API. */
  parentRequestId?: string | null;
  /** Server-issued session identity. Omit for the first request. */
  provider?: string | null;
  /** User-selected model snapshot, kept across automatic retries. */
  requestedModel?: string | null;
  /** User-selected provider snapshot, kept across automatic retries. */
  requestedProvider?: string | null;
  selection: DocumentRewriteSelection;
  sessionId?: string;
  toolCallId?: string | null;
  topicId?: string | null;
  /** Internal monotonic session turn. Defaults to 1 for a new session. */
  turnIndex?: number;
}

export interface DocumentRewriteRequestModelOptions {
  /** Complete Markdown proof for a request-scoped generated subtree. */
  canonicalizeRewriteProof?: (
    editorData: unknown,
    outputText: string,
    persistedText?: string,
  ) => boolean;
  /**
   * Canonicalize legacy Markdown output when an older applied row predates
   * `selection.appliedTextHash`. The database model owns only the proof
   * comparison; the server supplies the editor-owned Markdown parser.
   */
  canonicalizeRewriteText?: (text: string) => string;
  /** Capture-style text (block separators preserved) for a child selection. */
  captureRewriteText?: (text: string) => string;
}

export interface UpdateDocumentRewriteInstructionInput {
  instruction: string;
}

export interface ClaimDocumentRewriteRequestInput {
  attempt: number;
  leaseMs?: number;
  workerId: string;
}

export interface RenewDocumentRewriteLeaseInput {
  attempt: number;
  leaseMs?: number;
  workerId: string;
}

export interface UpdateDocumentRewriteProgressInput {
  attempt: number;
  progress: DocumentRewriteProgress | null;
  workerId: string;
}

export interface TransitionDocumentRewriteRequestInput {
  attempt: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  generationId?: string | null;
  lastCommandId?: string | null;
  model?: string | null;
  nextAttemptAt?: Date | null;
  outputText?: string | null;
  provider?: string | null;
  status: DocumentRewriteRequestStatus;
  workerId?: string;
}

export interface RetryDocumentRewriteRequestInput {
  attempt: number;
  delayMs?: number;
}

export interface RetryDocumentRewriteWorkerInput {
  attempt: number;
  delayMs?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  workerId: string;
}

export interface CancelDocumentRewriteRequestInput {
  attempt?: number;
}

export interface DocumentRewriteReviewProofInput {
  /** State vector observed after the Yjs Diff was accepted/rejected. */
  stateVector: string;
}

export interface DocumentRewriteDirectApplyInput {
  attempt: number;
  /** The deterministic command identity emitted by the direct editor command. */
  commandId: string;
  generationId?: string | null;
  model?: string | null;
  /** Exact replacement text, retained for safe continuation context. */
  outputText?: string | null;
  provider?: string | null;
  /** Optional state vector observed by the worker; history is the durable proof. */
  stateVector?: string | null;
  workerId: string;
}

export interface DocumentRewriteRequestResult {
  isDuplicate: boolean;
  request: DocumentRewriteRequestItem;
}

export interface DocumentRewriteTransitionResult {
  isDuplicate: boolean;
  request: DocumentRewriteRequestItem;
}

export interface ContinueDocumentRewriteRequestInput {
  instruction: string;
  /** Optional per-turn model override; omitted values inherit the parent turn. */
  model?: string | null;
  provider?: string | null;
  requestedModel?: string | null;
  requestedProvider?: string | null;
}

export interface DeleteDocumentRewriteSessionInput {
  /** Optional document guard used by the public router before the ACL check. */
  documentId?: string;
  requestId?: string;
  sessionId?: string;
}

export interface DeleteDocumentRewriteSessionResult {
  deletedCount: number;
  documentId: string;
  requestId: string;
  sessionId: string | null;
}

const now = () => new Date();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const progressStages = new Set<string>(DOCUMENT_REWRITE_PROGRESS_STAGES);
const progressTools = new Set<string>(DOCUMENT_REWRITE_PROGRESS_TOOLS);

const clipProgressText = (value: string, maxLength: number): string =>
  Array.from(value).slice(0, maxLength).join('');

const normalizeProgressTimestamp = (value: unknown): string => {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : now().toISOString();
};

/** Strip all provider/model fields down to the bounded public progress shape. */
export const normalizeDocumentRewriteProgress = (
  value: unknown,
): DocumentRewriteProgress | null => {
  if (!isRecord(value)) return null;
  const rawEvents = Array.isArray(value.events) ? value.events : [];
  const events: DocumentRewriteProgressEvent[] = [];

  for (const rawEvent of rawEvents.slice(-DOCUMENT_REWRITE_PROGRESS_MAX_EVENTS)) {
    if (!isRecord(rawEvent) || !progressStages.has(rawEvent.stage as string)) continue;
    const stage = rawEvent.stage as DocumentRewriteProgressStage;
    const detail =
      typeof rawEvent.detail === 'string'
        ? clipProgressText(rawEvent.detail, DOCUMENT_REWRITE_PROGRESS_DETAIL_MAX_LENGTH)
        : undefined;
    const summary =
      typeof rawEvent.summary === 'string'
        ? clipProgressText(rawEvent.summary, DOCUMENT_REWRITE_PROGRESS_SUMMARY_MAX_LENGTH)
        : undefined;
    const tool =
      typeof rawEvent.tool === 'string' && progressTools.has(rawEvent.tool)
        ? clipProgressText(rawEvent.tool, DOCUMENT_REWRITE_PROGRESS_TOOL_MAX_LENGTH)
        : undefined;
    events.push({
      at: normalizeProgressTimestamp(rawEvent.at),
      ...(detail ? { detail } : {}),
      stage,
      ...(summary ? { summary } : {}),
      ...(tool ? { tool } : {}),
    });
  }

  const currentStage = progressStages.has(value.currentStage as string)
    ? (value.currentStage as DocumentRewriteProgressStage)
    : events.at(-1)?.stage;
  if (!currentStage) return null;

  const summary =
    typeof value.summary === 'string'
      ? clipProgressText(value.summary, DOCUMENT_REWRITE_PROGRESS_SUMMARY_MAX_LENGTH)
      : undefined;
  return {
    currentStage,
    events,
    ...(summary ? { summary } : {}),
    updatedAt: normalizeProgressTimestamp(value.updatedAt),
  };
};

const sanitizeRequestProgress = (
  request: DocumentRewriteRequestItem,
): DocumentRewriteRequestItem => ({
  ...request,
  progress: normalizeDocumentRewriteProgress(request.progress),
});

/**
 * A review proof is accepted only after persistence has observed the same room
 * state vector and the current projection no longer contains this Diff. The
 * metadata lives in Lexical NodeState (`$`/`properties`) and is intentionally
 * inspected without hydrating a second editor in the request API.
 */
const hasPendingReviewDiff = (
  value: unknown,
  requestId: string,
  commandId: string,
  attempt: number,
  seen = new WeakSet<object>(),
): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value))
    return value.some((child) => hasPendingReviewDiff(child, requestId, commandId, attempt, seen));

  if (!isRecord(value)) return false;
  const nodeProperties = isRecord(value.$)
    ? isRecord(value.$.properties)
      ? value.$.properties
      : value.$
    : isRecord(value.properties)
      ? value.properties
      : value;
  const isDiffNode =
    value.type === 'diff' || value.type === 'table-row-diff' || value.type === 'table-cell-diff';
  if (
    isDiffNode &&
    nodeProperties.rewriteRequestId === requestId &&
    nodeProperties.rewriteCommandId === commandId &&
    (nodeProperties.rewriteAttempt === undefined || nodeProperties.rewriteAttempt === attempt)
  ) {
    return true;
  }
  return Object.values(value).some((child) =>
    hasPendingReviewDiff(child, requestId, commandId, attempt, seen),
  );
};

/**
 * Database-backed request lifecycle. Every mutation is conditional on the
 * request scope, current status, and attempt. A queue redelivery therefore
 * becomes an idempotent no-op instead of replaying a command or stealing a
 * live worker lease.
 */
export class DocumentRewriteRequestModel {
  private readonly db: LobeChatDatabase;
  private readonly canonicalizeRewriteText?: (text: string) => string;
  private readonly canonicalizeRewriteProof?: (
    editorData: unknown,
    outputText: string,
    persistedText?: string,
  ) => boolean;
  private readonly captureRewriteText?: (text: string) => string;
  private readonly userId: string;
  private readonly workspaceId?: string | null;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string | null,
    options: DocumentRewriteRequestModelOptions = {},
  ) {
    this.db = db;
    this.canonicalizeRewriteText = options.canonicalizeRewriteText;
    this.canonicalizeRewriteProof = options.canonicalizeRewriteProof;
    this.captureRewriteText = options.captureRewriteText;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private scope = () =>
    this.workspaceId
      ? eq(documentRewriteRequests.workspaceId, this.workspaceId)
      : and(
          isNull(documentRewriteRequests.workspaceId),
          eq(documentRewriteRequests.requestedByUserId, this.userId),
        );

  private documentScope = (documentId: string) =>
    this.workspaceId
      ? and(eq(documents.id, documentId), eq(documents.workspaceId, this.workspaceId))
      : and(
          eq(documents.id, documentId),
          isNull(documents.workspaceId),
          eq(documents.userId, this.userId),
        );

  private assertDocument = async (
    documentId: string,
    executor: LobeChatDatabase | Transaction = this.db,
    lock = false,
  ): Promise<void> => {
    const query = executor
      .select({ id: documents.id })
      .from(documents)
      .where(this.documentScope(documentId))
      .limit(1);
    const [document] = lock ? await query.for('update') : await query;
    if (!document) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);
  };

  private findScoped = async (
    id: string,
    executor: LobeChatDatabase | Transaction = this.db,
  ): Promise<DocumentRewriteRequestItem | undefined> => {
    const [request] = await executor
      .select()
      .from(documentRewriteRequests)
      .where(and(eq(documentRewriteRequests.id, id), this.scope()))
      .limit(1);
    return request ? sanitizeRequestProgress(request) : undefined;
  };

  /**
   * Serialize target reservation/claim operations for one document. The
   * target is an arbitrary node range, so a Postgres row lock is the durable
   * arbiter that keeps the overlap check and its following write atomic.
   */
  private lockDocument = async (documentId: string, executor: Transaction): Promise<void> => {
    await this.assertDocument(documentId, executor, true);
  };

  /**
   * Read the document-owned provenance projection while its row lock is held.
   * A browser AISessionService can legitimately be empty during hydration, so
   * continuation correctness must use this persisted snapshot instead.
   */
  private getPersistedAISessionProjection = async (
    documentId: string,
    sessionId: string,
    executor: Transaction,
  ) => {
    const [document] = await executor
      .select({ editorData: documents.editorData })
      .from(documents)
      .where(and(eq(documents.id, documentId), this.documentScope(documentId)))
      .for('update');

    return collectAISessionProjection(document?.editorData, sessionId);
  };

  private getPersistedAIBlockSessionProjection = async (
    documentId: string,
    sessionId: string,
    targetNodeId: string | undefined,
    executor: Transaction,
  ) => {
    const [document] = await executor
      .select({ editorData: documents.editorData })
      .from(documents)
      .where(and(eq(documents.id, documentId), this.documentScope(documentId)))
      .for('update');

    return collectAIBlockSessionProjection(document?.editorData, sessionId, targetNodeId ?? '');
  };

  private getPersistedBlockRewriteContext = async (
    documentId: string,
    sessionId: string,
    targetNodeId: string,
    adapterId: string,
    executor: Transaction,
  ) => {
    const [document] = await executor
      .select({ editorData: documents.editorData })
      .from(documents)
      .where(and(eq(documents.id, documentId), this.documentScope(documentId)))
      .for('update');

    return resolvePersistedBlockRewriteContext(
      document?.editorData,
      sessionId,
      targetNodeId,
      adapterId,
    );
  };

  private assertTargetAvailable = async (
    executor: LobeChatDatabase | Transaction,
    documentId: string,
    selection: DocumentRewriteSelection,
    targetNodeIds: string[],
    exceptId?: string,
  ): Promise<void> => {
    // The document row lock held by create/retry/claim makes this read and
    // the following mutation one atomic reservation. SQL array overlap is
    // intentionally not used: it cannot distinguish disjoint offsets in a
    // shared block.
    const active = await executor
      .select({
        id: documentRewriteRequests.id,
        selection: documentRewriteRequests.selection,
        targetNodeIds: documentRewriteRequests.targetNodeIds,
      })
      .from(documentRewriteRequests)
      .where(
        and(
          eq(documentRewriteRequests.documentId, documentId),
          exceptId ? ne(documentRewriteRequests.id, exceptId) : undefined,
          inArray(documentRewriteRequests.status, DOCUMENT_REWRITE_TARGET_HOLD_STATUSES),
        ),
      );
    for (const candidate of active) {
      if (
        documentRewriteSelectionsOverlap(
          { selection, targetNodeIds },
          { selection: candidate.selection, targetNodeIds: candidate.targetNodeIds },
        )
      ) {
        throw new Error(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: target already active`);
      }
    }
  };

  /**
   * Count held rows under the document lock. This query intentionally does
   * not apply the caller's user/workspace scope: a document is globally
   * identified, and all authorized members of a shared workspace consume the
   * same five slots. Read/mutation ACL remains scoped by `findScoped` and the
   * public model methods; only this document-owned capacity reservation is
   * global to the document.
   */
  private assertRequestCapacityAvailable = async (
    executor: LobeChatDatabase | Transaction,
    documentId: string,
    exceptId?: string,
  ): Promise<void> => {
    const heldRequests = await executor
      .select({ id: documentRewriteRequests.id })
      .from(documentRewriteRequests)
      .where(
        and(
          eq(documentRewriteRequests.documentId, documentId),
          exceptId ? ne(documentRewriteRequests.id, exceptId) : undefined,
          inArray(documentRewriteRequests.status, DOCUMENT_REWRITE_REQUEST_CAPACITY_STATUSES),
        ),
      )
      // Five rows are enough to decide the result, while the extra row avoids
      // depending on an exact count if a legacy deployment already contains
      // over-capacity data.
      .limit(DOCUMENT_REWRITE_MAX_ACTIVE_REQUESTS + 1);
    if (heldRequests.length >= DOCUMENT_REWRITE_MAX_ACTIVE_REQUESTS) {
      throw new Error(DOCUMENT_REWRITE_ACTIVE_LIMIT);
    }
  };

  /**
   * Re-check capacity while holding the document row lock. Room ticket
   * issuance calls this too, so a stale/hand-written ticket path cannot turn
   * an over-capacity document into a writable Agent room.
   */
  assertCapacityForRequest = async (
    id: string,
    attempt: number,
  ): Promise<DocumentRewriteRequestItem | undefined> => {
    const requestId = normalizeString(id, 'id');
    if (!Number.isInteger(attempt) || attempt < 1) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: attempt`);
    }
    return this.db.transaction(async (tx) => {
      const initial = await this.findScoped(requestId, tx);
      if (!initial || initial.attempt !== attempt) return undefined;
      await this.lockDocument(initial.documentId, tx);
      const current = await this.findScoped(requestId, tx);
      if (!current || current.attempt !== attempt) return undefined;
      if (
        (DOCUMENT_REWRITE_REQUEST_CAPACITY_STATUSES as readonly string[]).includes(current.status)
      ) {
        await this.assertRequestCapacityAvailable(tx, current.documentId, current.id);
      }
      return current;
    });
  };

  /**
   * Expiry is a durable terminal transition, not a read-side filter. A worker
   * that encounters an expired row must clear its lease so the queue cannot
   * retain a permanently unclaimable request.
   */
  private markExpired = async (
    id: string,
    attempt: number,
    currentTime: Date,
    executor: LobeChatDatabase | Transaction = this.db,
  ): Promise<void> => {
    await executor
      .update(documentRewriteRequests)
      .set({
        claimOwner: null,
        claimedAt: null,
        errorCode: 'EXPIRED',
        errorMessage: 'Document rewrite request expired before execution',
        leaseExpiresAt: null,
        status: 'stale',
        terminalAt: currentTime,
        updatedAt: currentTime,
        version: sql`${documentRewriteRequests.version} + 1`,
      })
      .where(
        and(
          eq(documentRewriteRequests.id, id),
          eq(documentRewriteRequests.attempt, attempt),
          lte(documentRewriteRequests.expiresAt, currentTime),
          // Do not rewrite a terminal request that another actor settled while
          // this worker was reading it.
          sql`${documentRewriteRequests.status} NOT IN ('applied', 'rejected', 'canceled', 'canceled_after_write', 'stale', 'failed')`,
          this.scope(),
        ),
      );
  };

  private markCanceledAfterLeaseLoss = async (
    id: string,
    attempt: number,
    currentTime: Date,
    executor: LobeChatDatabase | Transaction = this.db,
  ): Promise<void> => {
    const [current] = await executor
      .select()
      .from(documentRewriteRequests)
      .where(
        and(
          eq(documentRewriteRequests.id, id),
          eq(documentRewriteRequests.attempt, attempt),
          eq(documentRewriteRequests.status, 'cancel_requested'),
          this.scope(),
        ),
      )
      .for('update');
    if (current?.lastCommandId && (await this.hasDirectPersistence(current, executor))) {
      // The direct room update is already durable. A late cancellation cannot
      // turn that write into a rollback/canceled result after the lease dies.
      await executor
        .update(documentRewriteRequests)
        .set({
          errorCode: current.errorCode ?? 'CANCELED_AFTER_WRITE',
          errorMessage:
            current.errorMessage ?? 'Cancellation arrived after the direct rewrite was written',
          status: 'applied',
          terminalAt: current.terminalAt ?? currentTime,
          updatedAt: currentTime,
          version: sql`${documentRewriteRequests.version} + 1`,
          claimOwner: null,
          claimedAt: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(documentRewriteRequests.id, id),
            eq(documentRewriteRequests.attempt, attempt),
            eq(documentRewriteRequests.status, 'cancel_requested'),
            this.scope(),
          ),
        );
      return;
    }
    await executor
      .update(documentRewriteRequests)
      .set({
        claimOwner: null,
        claimedAt: null,
        leaseExpiresAt: null,
        status: 'canceled',
        terminalAt: currentTime,
        updatedAt: currentTime,
        version: sql`${documentRewriteRequests.version} + 1`,
      })
      .where(
        and(
          eq(documentRewriteRequests.id, id),
          eq(documentRewriteRequests.attempt, attempt),
          eq(documentRewriteRequests.status, 'cancel_requested'),
          or(
            isNull(documentRewriteRequests.leaseExpiresAt),
            lte(documentRewriteRequests.leaseExpiresAt, currentTime),
          ),
          this.scope(),
        ),
      );
  };

  /** Return true only when the room projection and request-linked Agent history are durable. */
  private hasDirectPersistence = async (
    current: DocumentRewriteRequestItem,
    executor: LobeChatDatabase | Transaction,
  ): Promise<boolean> => {
    const [roomState] = await executor
      .select({
        roomId: documentCollaborationStates.roomId,
        stateVector: documentCollaborationStates.stateVector,
        userId: documentCollaborationStates.userId,
        workspaceId: documentCollaborationStates.workspaceId,
      })
      .from(documentCollaborationStates)
      .where(eq(documentCollaborationStates.documentId, current.documentId))
      .for('update');
    if (
      !roomState ||
      roomState.roomId !== current.documentId ||
      !roomState.stateVector ||
      (current.workspaceId === null && roomState.userId !== current.requestedByUserId) ||
      roomState.workspaceId !== current.workspaceId
    ) {
      return false;
    }

    const [agentHistory] = await executor
      .select({ id: documentHistories.id })
      .from(documentHistories)
      .where(
        and(
          eq(documentHistories.documentId, current.documentId),
          eq(documentHistories.requestId, current.id),
          eq(documentHistories.source, 'agent_collaboration'),
          current.workspaceId === null
            ? and(
                eq(documentHistories.userId, current.requestedByUserId),
                isNull(documentHistories.workspaceId),
              )
            : eq(documentHistories.workspaceId, current.workspaceId),
        ),
      )
      .limit(1);
    return Boolean(agentHistory);
  };

  /**
   * Read the request-linked agent snapshot used for the apply proof. The
   * current document may already contain a human edit by the time the worker
   * settles the request; hashing the history snapshot keeps that edit visible
   * to the later continuation conflict check.
   */
  private getPersistedHistoryAISessionProjection = async (
    current: DocumentRewriteRequestItem,
    sessionId: string,
    executor: LobeChatDatabase | Transaction,
  ) => {
    const [history] = await executor
      .select({ editorData: documentHistories.editorData })
      .from(documentHistories)
      .where(
        and(
          eq(documentHistories.documentId, current.documentId),
          eq(documentHistories.requestId, current.id),
          eq(documentHistories.source, 'agent_collaboration'),
          current.workspaceId === null
            ? and(
                eq(documentHistories.userId, current.requestedByUserId),
                isNull(documentHistories.workspaceId),
              )
            : eq(documentHistories.workspaceId, current.workspaceId),
        ),
      )
      .limit(1);

    return collectAISessionProjection(history?.editorData, sessionId);
  };

  private getPersistedHistoryAIRequestProjection = async (
    current: DocumentRewriteRequestItem,
    generationId: string | null | undefined,
    executor: LobeChatDatabase | Transaction,
  ) => {
    const [history] = await executor
      .select({ editorData: documentHistories.editorData })
      .from(documentHistories)
      .where(
        and(
          eq(documentHistories.documentId, current.documentId),
          eq(documentHistories.requestId, current.id),
          eq(documentHistories.source, 'agent_collaboration'),
          current.workspaceId === null
            ? and(
                eq(documentHistories.userId, current.requestedByUserId),
                isNull(documentHistories.workspaceId),
              )
            : eq(documentHistories.workspaceId, current.workspaceId),
        ),
      )
      .limit(1);

    return collectAIRequestProjection(history?.editorData, current.id, generationId);
  };

  create = async (
    input: CreateDocumentRewriteRequestInput,
  ): Promise<DocumentRewriteRequestResult> => {
    const documentId = normalizeString(input.documentId, 'documentId');
    const agentId = normalizeString(input.agentId, 'agentId');
    const instruction = normalizeString(
      input.instruction,
      'instruction',
      DOCUMENT_REWRITE_INSTRUCTION_MAX_LENGTH,
    );
    const selection = normalizeSelection(input.selection);
    if (selection.targetKind === 'node' && selection.roomId !== documentId) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: selection.roomId`);
    }
    const targetNodeIds = targetNodeIdsFromSelection(selection);
    const targetKey = targetKeyFromNodeIds(targetNodeIds);
    // Materialize the id before inserting so the rewrite operation can use a
    // stable audit identity even when the caller does not provide an
    // idempotency key. The generated value is still server-owned.
    const id = input.id
      ? normalizeString(input.id, 'id')
      : idGenerator('documentRewriteRequests', 18);
    const sessionId = input.sessionId
      ? normalizeString(input.sessionId, 'sessionId', DOCUMENT_REWRITE_SESSION_MAX_LENGTH)
      : idGenerator('documentRewriteSessions', 18);
    const turnIndex = input.turnIndex ?? 1;
    if (!Number.isSafeInteger(turnIndex) || turnIndex < 1) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: turnIndex`);
    }
    const parentRequestId = input.parentRequestId
      ? normalizeString(input.parentRequestId, 'parentRequestId')
      : null;
    const requestedModel = input.requestedModel ?? input.model ?? null;
    const requestedProvider = input.requestedProvider ?? input.provider ?? null;
    const hasRequestedModel = input.requestedModel !== undefined || input.model !== undefined;
    const hasRequestedProvider =
      input.requestedProvider !== undefined || input.provider !== undefined;
    const values: NewDocumentRewriteRequest = {
      agentId,
      documentId,
      expiresAt: input.expiresAt,
      id,
      instruction,
      // `model`/`provider` are generation-result fields. The user choice lives
      // in requestedModel/requestedProvider so worker retries never erase it.
      model: null,
      operationId: input.operationId ?? `document-rewrite-${id}-operation`,
      parentRequestId,
      provider: null,
      requestedModel,
      requestedProvider,
      requestedByUserId: this.userId,
      selection,
      sessionId,
      quotedText: selection.quotedText,
      status: 'queued',
      targetKey,
      targetNodeIds,
      toolCallId: input.toolCallId ?? null,
      topicId: input.topicId ?? null,
      turnIndex,
      version: 1,
      workspaceId: this.workspaceId ?? null,
    };

    return this.db.transaction(async (tx) => {
      // Target overlap is not representable by a normal unique index. Locking
      // the document row serializes the check with other request reservations;
      // the exact selection range is then compared in TypeScript.
      await this.lockDocument(documentId, tx);
      // Resolve an idempotent replay before checking target ownership. The
      // request itself necessarily owns its target, so treating it as a new
      // conflict would make a safe retry fail.
      if (id) {
        const existing = await this.findScoped(id, tx);
        if (existing) {
          if (
            existing.documentId === documentId &&
            existing.agentId === agentId &&
            existing.instruction === instruction &&
            (!hasRequestedModel ||
              (existing.requestedModel ?? existing.model) === requestedModel) &&
            (!hasRequestedProvider ||
              (existing.requestedProvider ?? existing.provider) === requestedProvider) &&
            existing.targetKey === targetKey &&
            jsonEqual(
              selectionForRequestIdentity(existing.selection),
              selectionForRequestIdentity(selection),
            )
          ) {
            return { isDuplicate: true, request: existing };
          }
          throw new Error(DOCUMENT_REWRITE_REQUEST_CONFLICT);
        }
      }
      await this.assertTargetAvailable(tx, documentId, selection, targetNodeIds, id);
      // Capacity and target overlap are both reserved under the document row
      // lock. Excluding the id keeps a same-payload idempotent replay safe and
      // makes every retry/claim path use the same accounting rule.
      await this.assertRequestCapacityAvailable(tx, documentId, id);

      let topicId = input.topicId ?? null;
      if (topicId) {
        const [topic] = await tx
          .select({ id: topics.id, metadata: topics.metadata, trigger: topics.trigger })
          .from(topics)
          .where(
            and(
              eq(topics.id, topicId),
              eq(topics.trigger, DOCUMENT_REWRITE_TOPIC_TRIGGER),
              buildWorkspaceWhere(
                { userId: this.userId, workspaceId: this.workspaceId ?? undefined },
                topics,
              ),
            ),
          )
          .for('update');
        const rewriteMetadata = topic?.metadata?.documentRewrite;
        if (
          rewriteMetadata?.sessionId !== sessionId ||
          (rewriteMetadata.documentId !== undefined && rewriteMetadata.documentId !== documentId) ||
          (rewriteMetadata.agentId !== undefined && rewriteMetadata.agentId !== agentId)
        ) {
          throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: topicId`);
        }
      } else {
        // Topic.agent_id is an FK. Keep the internal topic usable for legacy
        // direct model callers whose audit agent row may already be gone;
        // production router calls have already passed the Agent ACL check.
        const [topicAgent] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(
            and(
              eq(agents.id, agentId),
              buildWorkspaceWhere(
                { userId: this.userId, workspaceId: this.workspaceId ?? undefined },
                agents,
              ),
            ),
          )
          .limit(1);
        const [topic] = await tx
          .insert(topics)
          .values(
            buildWorkspacePayload(
              { userId: this.userId, workspaceId: this.workspaceId ?? undefined },
              {
                agentId: topicAgent?.id ?? null,
                metadata: {
                  documentRewrite: { agentId, documentId, sessionId },
                },
                model: requestedModel,
                provider: requestedProvider,
                title: 'Document rewrite',
                trigger: DOCUMENT_REWRITE_TOPIC_TRIGGER,
              },
            ),
          )
          .returning({ id: topics.id });
        if (!topic) throw new Error(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: topic creation failed`);
        topicId = topic.id;
      }

      let request: DocumentRewriteRequestItem | undefined;
      try {
        [request] = await tx
          .insert(documentRewriteRequests)
          .values({ ...values, topicId })
          .onConflictDoNothing({ target: documentRewriteRequests.id })
          .returning();
      } catch (error) {
        if (targetKey && isUniqueViolation(error)) {
          throw new Error(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: target already active`, {
            cause: error,
          });
        }
        throw error;
      }
      if (request) return { isDuplicate: false, request };

      if (!id) throw new Error(DOCUMENT_REWRITE_REQUEST_CONFLICT);
      const existing = await this.findScoped(id, tx);
      if (!existing) throw new Error(DOCUMENT_REWRITE_REQUEST_CONFLICT);
      // The request id is the idempotency key. A retry with a different payload
      // is a conflict, not permission to mutate the original request.
      if (
        existing.documentId !== documentId ||
        existing.agentId !== agentId ||
        existing.instruction !== instruction ||
        (hasRequestedModel && (existing.requestedModel ?? existing.model) !== requestedModel) ||
        (hasRequestedProvider &&
          (existing.requestedProvider ?? existing.provider) !== requestedProvider) ||
        existing.targetKey !== targetKey ||
        !jsonEqual(
          selectionForRequestIdentity(existing.selection),
          selectionForRequestIdentity(selection),
        )
      ) {
        throw new Error(DOCUMENT_REWRITE_REQUEST_CONFLICT);
      }
      return { isDuplicate: true, request: existing };
    });
  };

  findById = async (id: string): Promise<DocumentRewriteRequestItem | undefined> =>
    this.findScoped(normalizeString(id, 'id'));

  /**
   * Delete one complete rewrite session without touching document content or
   * provenance. The document row is locked before the session rows, and every
   * turn must already be terminal so a worker cannot race a destructive UI
   * action. A legacy row without a session id resolves to that request only.
   */
  deleteSession = async (
    input: DeleteDocumentRewriteSessionInput,
  ): Promise<DeleteDocumentRewriteSessionResult | undefined> => {
    const requestId = input.requestId ? normalizeString(input.requestId, 'requestId') : undefined;
    const sessionId = input.sessionId
      ? normalizeString(input.sessionId, 'sessionId', DOCUMENT_REWRITE_SESSION_MAX_LENGTH)
      : undefined;
    const documentId = input.documentId
      ? normalizeString(input.documentId, 'documentId')
      : undefined;

    if ((requestId ? 1 : 0) + (sessionId ? 1 : 0) !== 1) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: requestId or sessionId required`);
    }

    return this.db.transaction(async (tx) => {
      const identity = requestId
        ? and(
            eq(documentRewriteRequests.id, requestId),
            documentId ? eq(documentRewriteRequests.documentId, documentId) : undefined,
          )
        : and(
            eq(documentRewriteRequests.sessionId, sessionId!),
            documentId ? eq(documentRewriteRequests.documentId, documentId) : undefined,
          );
      const [initial] = await tx
        .select()
        .from(documentRewriteRequests)
        .where(and(identity, this.scope()))
        .limit(1);
      if (!initial) return undefined;

      await this.lockDocument(initial.documentId, tx);

      const [anchor] = await tx
        .select()
        .from(documentRewriteRequests)
        .where(
          and(
            eq(documentRewriteRequests.id, initial.id),
            eq(documentRewriteRequests.documentId, initial.documentId),
            this.scope(),
          ),
        )
        .for('update');
      if (!anchor) return undefined;

      const sessionCondition = anchor.sessionId
        ? and(
            eq(documentRewriteRequests.documentId, anchor.documentId),
            eq(documentRewriteRequests.sessionId, anchor.sessionId),
            this.scope(),
          )
        : and(eq(documentRewriteRequests.id, anchor.id), this.scope());
      const sessionRows = await tx
        .select()
        .from(documentRewriteRequests)
        .where(sessionCondition)
        .for('update');
      if (sessionRows.length === 0) return undefined;
      if (sessionRows.some((row) => !isDocumentRewriteTerminal(row.status))) {
        throw new Error(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: session is still active`);
      }

      const deleted = await tx
        .delete(documentRewriteRequests)
        .where(sessionCondition)
        .returning({ id: documentRewriteRequests.id });

      if (anchor.topicId) {
        await tx
          .delete(topics)
          .where(
            and(
              eq(topics.id, anchor.topicId),
              eq(topics.trigger, DOCUMENT_REWRITE_TOPIC_TRIGGER),
              buildWorkspaceWhere(
                { userId: this.userId, workspaceId: this.workspaceId ?? undefined },
                topics,
              ),
            ),
          );
      }

      return {
        deletedCount: deleted.length,
        documentId: anchor.documentId,
        requestId: anchor.id,
        sessionId: anchor.sessionId ?? null,
      };
    });
  };

  /** Create the next turn from the parent row; anchors/history are never client supplied. */
  continue = async (
    parentId: string,
    input: ContinueDocumentRewriteRequestInput,
  ): Promise<DocumentRewriteRequestResult | undefined> => {
    const requestId = normalizeString(parentId, 'parentRequestId');
    const instruction = normalizeString(
      input.instruction,
      'instruction',
      DOCUMENT_REWRITE_INSTRUCTION_MAX_LENGTH,
    );

    return this.db.transaction(async (tx) => {
      const [parent] = await tx
        .select()
        .from(documentRewriteRequests)
        .where(and(eq(documentRewriteRequests.id, requestId), this.scope()))
        .for('update');
      if (!parent) return undefined;
      if (parent.status !== 'applied' || typeof parent.outputText !== 'string') {
        throw new Error(
          `${DOCUMENT_REWRITE_REQUEST_CONFLICT}: continuation requires an applied output`,
        );
      }
      await this.lockDocument(parent.documentId, tx);
      const [latestParent] = await tx
        .select()
        .from(documentRewriteRequests)
        .where(and(eq(documentRewriteRequests.id, requestId), this.scope()))
        .for('update');
      if (
        !latestParent ||
        latestParent.status !== 'applied' ||
        typeof latestParent.outputText !== 'string'
      ) {
        return undefined;
      }

      let persistedBlockContext: ReturnType<typeof resolvePersistedBlockRewriteContext> | undefined;
      let persistedTextProjection: string | undefined;
      let persistedTextCapture: string | undefined;
      let persistedTextTargetNodeIds: string[] | undefined;
      if (latestParent.sessionId) {
        const isNodeTarget = latestParent.selection.targetKind === 'node';
        persistedBlockContext = isNodeTarget
          ? await this.getPersistedBlockRewriteContext(
              latestParent.documentId,
              latestParent.sessionId,
              latestParent.selection.targetNodeId ?? '',
              latestParent.selection.adapterId ?? '',
              tx,
            )
          : undefined;
        const projection = isNodeTarget
          ? persistedBlockContext?.status === 'found'
            ? { rangeCount: 1, text: persistedBlockContext.context.source }
            : { rangeCount: 0, text: '' }
          : await this.getPersistedAISessionProjection(
              latestParent.documentId,
              latestParent.sessionId,
              tx,
            );
        if (isNodeTarget && persistedBlockContext?.status === 'adapter-mismatch') {
          throw new Error(
            `${DOCUMENT_REWRITE_CONTINUATION_CHANGED}: persisted node adapter identity changed`,
          );
        }
        if (projection.rangeCount === 0) {
          throw new Error(
            `${DOCUMENT_REWRITE_CONTINUATION_DELETED}: persisted node provenance is missing`,
          );
        }
        if (!isNodeTarget) persistedTextProjection = projection.text;
        if (!isNodeTarget) persistedTextTargetNodeIds = projection.targetNodeIds;
        const appliedTextHash = isNodeTarget ? undefined : latestParent.selection.appliedTextHash;
        const rawMatches =
          normalizeRewriteText(projection.text) === normalizeRewriteText(latestParent.outputText);
        const canonicalText =
          !isNodeTarget && appliedTextHash === undefined && !rawMatches
            ? this.canonicalizeRewriteText?.(latestParent.outputText)
            : undefined;
        const projectionMatches = isNodeTarget
          ? rawMatches
          : appliedTextHash
            ? hashRewriteText(projection.text) === appliedTextHash
            : rawMatches ||
              (canonicalText !== undefined &&
                normalizeRewriteText(projection.text) === normalizeRewriteText(canonicalText));
        if (!projectionMatches) {
          throw new Error(
            `${DOCUMENT_REWRITE_CONTINUATION_CHANGED}: persisted session output changed`,
          );
        }
        if (!isNodeTarget) {
          const shouldCaptureCanonicalText =
            appliedTextHash !== undefined || (!rawMatches && canonicalText !== undefined);
          persistedTextCapture = shouldCaptureCanonicalText
            ? (this.captureRewriteText?.(latestParent.outputText) ?? projection.text)
            : projection.text;
        }
      }

      const [latestTurn] = await tx
        .select({
          id: documentRewriteRequests.id,
          status: documentRewriteRequests.status,
          turnIndex: documentRewriteRequests.turnIndex,
        })
        .from(documentRewriteRequests)
        .where(
          and(
            eq(documentRewriteRequests.documentId, latestParent.documentId),
            eq(documentRewriteRequests.sessionId, latestParent.sessionId),
          ),
        )
        .orderBy(desc(documentRewriteRequests.turnIndex), desc(documentRewriteRequests.createdAt))
        .limit(1);
      if (
        latestTurn &&
        latestTurn.id !== latestParent.id &&
        !canContinuePastLatestTurn(latestTurn.status)
      ) {
        throw new Error(
          `${DOCUMENT_REWRITE_REQUEST_CONFLICT}: continuation parent is not the latest turn`,
        );
      }
      const turnIndex = latestTurn ? latestTurn.turnIndex + 1 : latestParent.turnIndex + 1;
      // Relative positions remain the editor-owned current target. Refreshing
      // the proof text forces the worker to re-resolve the range against the
      // current collaborative document before generation/write.
      const continuationSelection = { ...latestParent.selection };
      const refreshTextTargetIdentity = latestParent.selection.kind === 'relative';
      // The hash proves the parent apply only. A new turn must not inherit it
      // as if its own output had already been written.
      delete continuationSelection.appliedTextHash;
      if (
        refreshTextTargetIdentity &&
        persistedTextTargetNodeIds &&
        persistedTextTargetNodeIds.length > 0
      ) {
        // The old paragraph/list target ids are no longer authoritative after
        // a structural Markdown rewrite. Keep the relative anchors as the
        // transient fallback, but let the server/worker lease the current
        // provenance blocks below.
        delete continuationSelection.startNodeId;
        delete continuationSelection.endNodeId;
        delete continuationSelection.startOffset;
        delete continuationSelection.endOffset;
      }
      const selection = normalizeSelection({
        ...continuationSelection,
        capturedAt: new Date().toISOString(),
        ...(latestParent.selection.targetKind === 'node' &&
        persistedBlockContext?.status === 'found'
          ? {
              quotedText: persistedBlockContext.context.quotedText,
              quotedTextHash: hashRewriteText(persistedBlockContext.context.quotedText),
              sourceHash: persistedBlockContext.context.sourceHash,
            }
          : latestParent.selection.targetKind === 'node'
            ? {}
            : {
                quotedText:
                  persistedTextCapture ?? persistedTextProjection ?? latestParent.outputText,
                quotedTextHash: hashRewriteText(
                  persistedTextCapture ?? persistedTextProjection ?? latestParent.outputText,
                ),
                ...(refreshTextTargetIdentity &&
                persistedTextTargetNodeIds &&
                persistedTextTargetNodeIds.length > 0
                  ? { targetNodeIds: persistedTextTargetNodeIds }
                  : {}),
              }),
      });
      const targetNodeIds = targetNodeIdsFromSelection(selection);
      await this.assertTargetAvailable(tx, latestParent.documentId, selection, targetNodeIds);
      await this.assertRequestCapacityAvailable(tx, latestParent.documentId);

      const [request] = await tx
        .insert(documentRewriteRequests)
        .values({
          agentId: latestParent.agentId,
          documentId: latestParent.documentId,
          instruction,
          // Continuations are new turns; keep generation fields empty until
          // the selected model actually returns a result.
          model: null,
          // Every continuation is a fresh operation/attempt while the topic
          // remains the durable conversation. Model/provider values inherit
          // from the parent when the caller does not override them.
          operationId: `document-rewrite-${latestParent.sessionId}-${turnIndex}-operation`,
          parentRequestId: latestParent.id,
          requestedByUserId: latestParent.requestedByUserId,
          selection,
          sessionId: latestParent.sessionId,
          quotedText: selection.quotedText,
          requestedModel:
            input.requestedModel ??
            (input.model !== undefined
              ? input.model
              : (latestParent.requestedModel ?? latestParent.model)),
          requestedProvider:
            input.requestedProvider ??
            (input.provider !== undefined
              ? input.provider
              : (latestParent.requestedProvider ?? latestParent.provider)),
          status: 'queued',
          targetKey: targetKeyFromNodeIds(targetNodeIds),
          targetNodeIds,
          topicId: latestParent.topicId,
          toolCallId: latestParent.toolCallId,
          turnIndex,
          version: 1,
          provider: null,
          workspaceId: latestParent.workspaceId,
        })
        .returning();
      if (!request) throw new Error(DOCUMENT_REWRITE_REQUEST_CONFLICT);
      return { isDuplicate: false, request };
    });
  };

  /**
   * Update only the user-facing instruction, and only before a worker claims
   * the request. The row lock makes the queued-state check atomic with the
   * write, so a concurrent worker cannot start with a stale instruction.
   */
  updateInstruction = async (
    id: string,
    input: UpdateDocumentRewriteInstructionInput,
  ): Promise<DocumentRewriteRequestItem | undefined> => {
    const requestId = normalizeString(id, 'id');
    const instruction = normalizeString(
      input.instruction,
      'instruction',
      DOCUMENT_REWRITE_INSTRUCTION_MAX_LENGTH,
    );

    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(documentRewriteRequests)
        .where(and(eq(documentRewriteRequests.id, requestId), this.scope()))
        .for('update');
      if (!current) return undefined;

      // Replaying the same payload is idempotent, even after the worker has
      // moved the request beyond queued. A different instruction must never
      // rewrite an in-flight or reviewed request.
      if (current.instruction === instruction) return current;
      if (current.status !== 'queued') {
        throw new Error(
          `${DOCUMENT_REWRITE_REQUEST_CONFLICT}: instruction can only be updated while queued`,
        );
      }

      const currentTime = now();
      const [updated] = await tx
        .update(documentRewriteRequests)
        .set({
          instruction,
          updatedAt: currentTime,
          version: sql`${documentRewriteRequests.version} + 1`,
        })
        .where(
          and(
            eq(documentRewriteRequests.id, requestId),
            eq(documentRewriteRequests.status, 'queued'),
            this.scope(),
          ),
        )
        .returning();
      return updated ?? current;
    });
  };

  list = async (
    options: {
      documentId?: string;
      limit?: number;
      statuses?: DocumentRewriteRequestStatus[];
    } = {},
  ): Promise<DocumentRewriteRequestItem[]> => {
    const conditions = [this.scope()];
    if (options.documentId)
      conditions.push(eq(documentRewriteRequests.documentId, options.documentId));
    if (options.statuses?.length) {
      conditions.push(inArray(documentRewriteRequests.status, options.statuses));
    }
    const rows = await this.db
      .select()
      .from(documentRewriteRequests)
      .where(and(...conditions))
      .orderBy(desc(documentRewriteRequests.createdAt), desc(documentRewriteRequests.id))
      .limit(Math.min(Math.max(options.limit ?? 50, 1), 200));
    return rows.map(sanitizeRequestProgress);
  };

  /**
   * Atomically acquire or renew a worker lease. A live lease owned by the same
   * worker is returned unchanged; a second worker wins only after expiry.
   */
  claim = async (
    id: string,
    input: ClaimDocumentRewriteRequestInput,
  ): Promise<DocumentRewriteRequestItem | undefined> => {
    const requestId = normalizeString(id, 'id');
    const workerId = normalizeString(input.workerId, 'workerId');
    if (!Number.isInteger(input.attempt) || input.attempt < 1) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: attempt`);
    }
    return this.db.transaction(async (tx) => {
      const initial = await this.findScoped(requestId, tx);
      if (!initial || initial.attempt !== input.attempt) return undefined;

      // Claiming and checking overlap must use the same document lock as
      // create/retry. Otherwise two pre-existing overlapping rows could both
      // pass the read-side check before either lease is written.
      await this.lockDocument(initial.documentId, tx);
      const current = await this.findScoped(requestId, tx);
      if (!current || current.attempt !== input.attempt) return undefined;
      const currentTime = now();
      if (current.expiresAt && current.expiresAt.getTime() <= currentTime.getTime()) {
        await this.markExpired(requestId, input.attempt, currentTime, tx);
        return undefined;
      }
      if (current.status === 'cancel_requested') {
        if (!current.leaseExpiresAt || current.leaseExpiresAt.getTime() <= currentTime.getTime()) {
          await this.markCanceledAfterLeaseLoss(requestId, input.attempt, currentTime, tx);
        }
        return undefined;
      }
      await this.assertRequestCapacityAvailable(tx, current.documentId, current.id);
      await this.assertTargetAvailable(
        tx,
        current.documentId,
        current.selection,
        current.targetNodeIds,
        current.id,
      );
      if (
        current.claimOwner === workerId &&
        current.leaseExpiresAt &&
        current.leaseExpiresAt.getTime() > currentTime.getTime() &&
        (DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES as readonly string[]).includes(current.status)
      ) {
        return current;
      }

      const leaseExpiresAt = new Date(currentTime.getTime() + safeLeaseMs(input.leaseMs));
      const claimable = or(
        eq(documentRewriteRequests.status, 'queued'),
        and(
          eq(documentRewriteRequests.status, 'retry_wait'),
          or(
            isNull(documentRewriteRequests.nextAttemptAt),
            lte(documentRewriteRequests.nextAttemptAt, currentTime),
          ),
        ),
        and(
          inArray(documentRewriteRequests.status, ['connecting', 'syncing', 'thinking', 'writing']),
          or(
            isNull(documentRewriteRequests.leaseExpiresAt),
            lte(documentRewriteRequests.leaseExpiresAt, currentTime),
          ),
        ),
      );
      const [claimed] = await tx
        .update(documentRewriteRequests)
        .set({
          claimOwner: workerId,
          claimedAt: currentTime,
          leaseExpiresAt,
          nextAttemptAt: null,
          status: 'connecting',
          updatedAt: currentTime,
          version: sql`${documentRewriteRequests.version} + 1`,
        })
        .where(
          and(
            eq(documentRewriteRequests.id, requestId),
            eq(documentRewriteRequests.attempt, input.attempt),
            claimable,
            or(
              isNull(documentRewriteRequests.claimOwner),
              eq(documentRewriteRequests.claimOwner, workerId),
              lte(documentRewriteRequests.leaseExpiresAt, currentTime),
            ),
            this.scope(),
          ),
        )
        .returning();
      return claimed;
    });
  };

  renewLease = async (
    id: string,
    input: RenewDocumentRewriteLeaseInput,
  ): Promise<DocumentRewriteRequestItem | undefined> => {
    const requestId = normalizeString(id, 'id');
    const workerId = normalizeString(input.workerId, 'workerId');
    const currentTime = now();
    const [request] = await this.db
      .update(documentRewriteRequests)
      .set({
        leaseExpiresAt: new Date(currentTime.getTime() + safeLeaseMs(input.leaseMs)),
        updatedAt: currentTime,
        version: sql`${documentRewriteRequests.version} + 1`,
      })
      .where(
        and(
          eq(documentRewriteRequests.id, requestId),
          eq(documentRewriteRequests.attempt, input.attempt),
          eq(documentRewriteRequests.claimOwner, workerId),
          inArray(documentRewriteRequests.status, DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES),
          or(
            isNull(documentRewriteRequests.leaseExpiresAt),
            gt(documentRewriteRequests.leaseExpiresAt, currentTime),
          ),
          this.scope(),
        ),
      )
      .returning();
    return request;
  };

  /** Persist only the bounded public progress projection for a live worker. */
  updateProgress = async (
    id: string,
    input: UpdateDocumentRewriteProgressInput,
  ): Promise<DocumentRewriteRequestItem | undefined> => {
    const requestId = normalizeString(id, 'id');
    const workerId = normalizeString(input.workerId, 'workerId');
    if (!Number.isInteger(input.attempt) || input.attempt < 1) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: attempt`);
    }
    const progress = input.progress ? normalizeDocumentRewriteProgress(input.progress) : null;
    if (input.progress !== null && !progress) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: progress`);
    }
    const currentTime = now();
    const [request] = await this.db
      .update(documentRewriteRequests)
      .set({
        progress,
        updatedAt: currentTime,
        version: sql`${documentRewriteRequests.version} + 1`,
      })
      .where(
        and(
          eq(documentRewriteRequests.id, requestId),
          eq(documentRewriteRequests.attempt, input.attempt),
          eq(documentRewriteRequests.claimOwner, workerId),
          inArray(documentRewriteRequests.status, DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES),
          or(
            isNull(documentRewriteRequests.leaseExpiresAt),
            gt(documentRewriteRequests.leaseExpiresAt, currentTime),
          ),
          this.scope(),
        ),
      )
      .returning();
    return request;
  };

  transition = async (
    id: string,
    input: TransitionDocumentRewriteRequestInput,
  ): Promise<DocumentRewriteTransitionResult | undefined> => {
    const requestId = normalizeString(id, 'id');
    const current = await this.findScoped(requestId);
    if (!current || current.attempt !== input.attempt) return undefined;
    const isReviewSettlement =
      (current.status === 'awaiting_review' || current.status === 'canceled_after_write') &&
      (input.status === 'applied' || input.status === 'rejected');
    if (
      current.status === input.status &&
      (isDocumentRewriteTerminal(current.status) || current.status === 'awaiting_review')
    ) {
      return { isDuplicate: true, request: current };
    }
    if (!isReviewSettlement && !input.workerId) {
      throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_CLAIMED);
    }
    if (current.status === input.status) return { isDuplicate: true, request: current };
    if (
      (input.status === 'awaiting_review' || input.status === 'canceled_after_write') &&
      !input.lastCommandId &&
      !current.lastCommandId
    ) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: lastCommandId required for review`);
    }
    assertDocumentRewriteTransition(current.status, input.status);

    const currentTime = now();
    if (
      current.expiresAt &&
      current.expiresAt.getTime() <= currentTime.getTime() &&
      input.status !== 'stale'
    ) {
      throw new Error(DOCUMENT_REWRITE_REQUEST_EXPIRED);
    }
    const workerCondition = isReviewSettlement
      ? undefined
      : input.workerId
        ? and(
            eq(documentRewriteRequests.claimOwner, normalizeString(input.workerId, 'workerId')),
            gt(documentRewriteRequests.leaseExpiresAt, currentTime),
          )
        : undefined;
    const terminal = isDocumentRewriteTerminal(input.status);
    const releaseWorker = terminal || input.status === 'awaiting_review';
    const [request] = await this.db
      .update(documentRewriteRequests)
      .set({
        errorCode: input.errorCode === undefined ? current.errorCode : input.errorCode,
        errorMessage: input.errorMessage === undefined ? current.errorMessage : input.errorMessage,
        generationId: input.generationId === undefined ? current.generationId : input.generationId,
        lastCommandId:
          input.lastCommandId === undefined ? current.lastCommandId : input.lastCommandId,
        model: input.model === undefined ? current.model : input.model,
        nextAttemptAt:
          input.nextAttemptAt === undefined ? current.nextAttemptAt : input.nextAttemptAt,
        outputText: input.outputText === undefined ? current.outputText : input.outputText,
        provider: input.provider === undefined ? current.provider : input.provider,
        status: input.status,
        terminalAt: terminal ? (current.terminalAt ?? currentTime) : null,
        updatedAt: currentTime,
        version: sql`${documentRewriteRequests.version} + 1`,
        ...(releaseWorker
          ? {
              claimOwner: null,
              claimedAt: null,
              leaseExpiresAt: null,
            }
          : {}),
      })
      .where(
        and(
          eq(documentRewriteRequests.id, requestId),
          eq(documentRewriteRequests.status, current.status),
          eq(documentRewriteRequests.attempt, input.attempt),
          workerCondition,
          this.scope(),
        ),
      )
      .returning();
    if (request) return { isDuplicate: false, request };
    const raced = await this.findScoped(requestId);
    if (!raced) return undefined;
    if (raced.attempt === input.attempt && raced.status === input.status) {
      return { isDuplicate: true, request: raced };
    }
    throw new Error(DOCUMENT_REWRITE_REQUEST_CONFLICT);
  };

  /**
   * Settle a direct rewrite only after the room persistence worker has written
   * an agent-linked projection. This is deliberately separate from
   * `settleReview`: direct requests never create a Diff and cannot be changed
   * by a browser review action.
   *
   * The state-vector argument is useful for diagnostics and lets callers prove
   * that they observed a room update. The request-linked history row is the
   * durable identity check: a human may type again before this method runs,
   * which legitimately advances the room vector beyond the command's vector.
   */
  markDirectApplied = async (
    id: string,
    input: DocumentRewriteDirectApplyInput,
  ): Promise<DocumentRewriteTransitionResult | undefined> => {
    const requestId = normalizeString(id, 'id');
    const commandId = normalizeString(input.commandId, 'commandId');
    const workerId = normalizeString(input.workerId, 'workerId');
    if (!Number.isInteger(input.attempt) || input.attempt < 1) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: attempt`);
    }
    if (input.stateVector !== undefined && input.stateVector !== null) {
      const stateVector = input.stateVector.trim();
      if (!stateVector || stateVector.length > 16_384) {
        throw new Error(`${DOCUMENT_REWRITE_DIRECT_APPLY_PROOF_INVALID}: stateVector`);
      }
    }
    if (
      input.outputText !== undefined &&
      input.outputText !== null &&
      input.outputText.length > 32_768
    ) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: outputText`);
    }

    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(documentRewriteRequests)
        .where(and(eq(documentRewriteRequests.id, requestId), this.scope()))
        .for('update');
      if (!current || current.attempt !== input.attempt) return undefined;
      if (current.status === 'applied') return { isDuplicate: true, request: current };

      // A direct command can only settle its own live write. In particular,
      // this prevents a late worker from turning an old queued/retry row into
      // applied merely because a request-linked history row exists.
      if (
        current.status !== 'writing' &&
        current.status !== 'connecting' &&
        current.status !== 'cancel_requested'
      ) {
        return undefined;
      }
      const nowTime = now();
      if (
        current.claimOwner !== workerId ||
        !current.leaseExpiresAt ||
        current.leaseExpiresAt.getTime() <= nowTime.getTime()
      ) {
        return undefined;
      }
      if (current.lastCommandId && current.lastCommandId !== commandId) {
        throw new Error(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: command mismatch`);
      }
      if (current.status === 'connecting' && !current.lastCommandId) return undefined;

      if (
        typeof input.outputText !== 'string' ||
        typeof input.generationId !== 'string' ||
        input.generationId.trim().length === 0 ||
        current.generationId !== input.generationId
      ) {
        // A direct transition without a final payload/generation proof is not
        // recoverable completion evidence, even when a request-linked room
        // history row exists. The generation must be the one recorded while
        // this worker owned the writing transition; a caller cannot attach a
        // different generation's room projection to this request.
        return undefined;
      }

      // The worker supplies this only after the generator has completed and
      // its accepted chunks match the final payload. Keep that expectation
      // even if the room history is still catching up, so a recovered worker
      // can prove the same result instead of losing it after a timeout.
      if (current.selection.targetKind !== 'node') {
        if (current.outputText !== null && current.outputText !== input.outputText)
          return undefined;
        if (current.outputText === null) {
          await tx
            .update(documentRewriteRequests)
            .set({
              outputText: input.outputText,
              updatedAt: nowTime,
              version: sql`${documentRewriteRequests.version} + 1`,
            })
            .where(and(eq(documentRewriteRequests.id, requestId), this.scope()));
        }
      }

      if (!(await this.hasDirectPersistence(current, tx))) return undefined;

      let selection = current.selection;
      if (current.selection.targetKind !== 'node' && current.id) {
        const requestProjection = await this.getPersistedHistoryAIRequestProjection(
          current,
          input.generationId ?? current.generationId,
          tx,
        );
        const hasGeneratedProjection =
          requestProjection.rangeCount > 0 || (requestProjection.generatedNodeCount ?? 0) > 0;
        if (input.outputText.length > 0 && !hasGeneratedProjection) {
          // A non-empty final payload must have a request/generation-scoped
          // persisted projection. Session-level history or an empty snapshot
          // is not sufficient evidence for an applied terminal state.
          return undefined;
        }
        if (hasGeneratedProjection) {
          const hasCompleteProof = Boolean(
            requestProjection.generatedEditorData && this.canonicalizeRewriteProof,
          );
          if (hasCompleteProof) {
            if (
              !this.canonicalizeRewriteProof!(
                requestProjection.generatedEditorData!,
                input.outputText,
                requestProjection.text,
              )
            ) {
              return undefined;
            }
          } else {
            const rawMatches =
              normalizeRewriteText(requestProjection.text) ===
              normalizeRewriteText(input.outputText);
            const canonicalText = rawMatches
              ? input.outputText
              : this.canonicalizeRewriteText?.(input.outputText);
            if (
              canonicalText === undefined ||
              normalizeRewriteText(requestProjection.text) !== normalizeRewriteText(canonicalText)
            ) {
              return undefined;
            }
          }
        }
      }
      if (current.selection.targetKind !== 'node' && current.sessionId) {
        const appliedProjection = await this.getPersistedHistoryAISessionProjection(
          current,
          current.sessionId,
          tx,
        );
        if (appliedProjection.rangeCount > 0) {
          selection = {
            ...selection,
            appliedTextHash: hashRewriteText(appliedProjection.text),
          };
        }
      }

      const [request] = await tx
        .update(documentRewriteRequests)
        .set({
          errorCode:
            current.status === 'cancel_requested'
              ? (current.errorCode ?? 'CANCELED_AFTER_WRITE')
              : null,
          errorMessage:
            current.status === 'cancel_requested'
              ? (current.errorMessage ??
                'Cancellation arrived after the direct rewrite was written')
              : null,
          generationId:
            input.generationId === undefined ? current.generationId : input.generationId,
          lastCommandId: commandId,
          model: input.model === undefined ? current.model : input.model,
          outputText: input.outputText === undefined ? current.outputText : input.outputText,
          provider: input.provider === undefined ? current.provider : input.provider,
          selection,
          status: 'applied',
          terminalAt: current.terminalAt ?? nowTime,
          updatedAt: nowTime,
          version: sql`${documentRewriteRequests.version} + 1`,
          claimOwner: null,
          claimedAt: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(documentRewriteRequests.id, requestId),
            eq(documentRewriteRequests.attempt, input.attempt),
            eq(documentRewriteRequests.status, current.status),
            eq(documentRewriteRequests.claimOwner, workerId),
            this.scope(),
          ),
        )
        .returning();
      if (request) return { isDuplicate: false, request };

      const raced = await this.findScoped(requestId, tx);
      return raced?.attempt === input.attempt && raced.status === 'applied'
        ? { isDuplicate: true, request: raced }
        : undefined;
    });
  };

  /** Browser-only settlement path; it cannot mutate worker/transient fields. */
  settleReview = async (
    id: string,
    input: {
      attempt: number;
      expectedCommandId?: string | null;
      proof?: DocumentRewriteReviewProofInput;
      status: 'applied' | 'rejected';
    },
  ): Promise<DocumentRewriteTransitionResult | undefined> => {
    const requestId = normalizeString(id, 'id');
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(documentRewriteRequests)
        .where(and(eq(documentRewriteRequests.id, requestId), this.scope()))
        .for('update');
      if (!current || current.attempt !== input.attempt) return undefined;

      // `commandId` is an expected value from the Diff command, never a
      // user-writable audit field. This prevents a reviewer from replacing the
      // worker's last command id while settling the same pending diff.
      if (
        current.lastCommandId !== null &&
        current.lastCommandId !== undefined &&
        input.expectedCommandId !== current.lastCommandId
      ) {
        throw new Error(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: command mismatch`);
      }
      if (
        (current.lastCommandId === null || current.lastCommandId === undefined) &&
        input.expectedCommandId !== undefined &&
        input.expectedCommandId !== null
      ) {
        throw new Error(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: command mismatch`);
      }
      if (current.status !== 'awaiting_review' && current.status !== 'canceled_after_write') {
        if (current.status === input.status) return { isDuplicate: true, request: current };
        throw new Error(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: review status=${current.status}`);
      }

      const commandId = current.lastCommandId;
      if (!commandId) {
        throw new Error(`${DOCUMENT_REWRITE_REVIEW_PROOF_INVALID}: commandId required`);
      }
      if (input.proof) {
        if (
          typeof input.proof.stateVector !== 'string' ||
          input.proof.stateVector.length === 0 ||
          input.proof.stateVector.length > 16_384
        ) {
          throw new Error(`${DOCUMENT_REWRITE_REVIEW_PROOF_INVALID}: stateVector`);
        }

        const [roomState] = await tx
          .select({
            roomId: documentCollaborationStates.roomId,
            stateVector: documentCollaborationStates.stateVector,
            userId: documentCollaborationStates.userId,
            workspaceId: documentCollaborationStates.workspaceId,
          })
          .from(documentCollaborationStates)
          .where(eq(documentCollaborationStates.documentId, current.documentId))
          .for('update');
        if (
          !roomState ||
          roomState.roomId !== current.documentId ||
          roomState.stateVector !== input.proof.stateVector ||
          roomState.userId !== current.requestedByUserId ||
          roomState.workspaceId !== current.workspaceId
        ) {
          throw new Error(`${DOCUMENT_REWRITE_REVIEW_PROOF_INVALID}: room state is not persisted`);
        }

        const [agentHistory] = await tx
          .select({ editorData: documentHistories.editorData })
          .from(documentHistories)
          .where(
            and(
              eq(documentHistories.documentId, current.documentId),
              eq(documentHistories.requestId, current.id),
              eq(documentHistories.source, 'agent_collaboration'),
              eq(documentHistories.userId, current.requestedByUserId),
              current.workspaceId === null
                ? isNull(documentHistories.workspaceId)
                : eq(documentHistories.workspaceId, current.workspaceId),
            ),
          )
          .limit(1);
        if (!agentHistory) {
          throw new Error(
            `${DOCUMENT_REWRITE_REVIEW_PROOF_INVALID}: Diff history is not persisted`,
          );
        }

        const [document] = await tx
          .select({ editorData: documents.editorData })
          .from(documents)
          .where(and(eq(documents.id, current.documentId), this.documentScope(current.documentId)))
          .limit(1);
        if (
          !document ||
          hasPendingReviewDiff(document.editorData, current.id, commandId, input.attempt)
        ) {
          throw new Error(`${DOCUMENT_REWRITE_REVIEW_PROOF_INVALID}: Diff is still pending`);
        }
      } else {
        // The API/service boundary always supplies proof. Keeping the model
        // optional preserves older direct model fixtures while making the
        // production request service fail closed below.
      }

      assertDocumentRewriteTransition(current.status, input.status);
      const currentTime = now();
      const cancelAfterWrite = current.status === 'canceled_after_write';
      const [request] = await tx
        .update(documentRewriteRequests)
        .set({
          errorCode:
            input.status === 'applied'
              ? cancelAfterWrite
                ? (current.errorCode ?? 'CANCELED_AFTER_WRITE')
                : null
              : current.errorCode,
          errorMessage:
            input.status === 'applied'
              ? cancelAfterWrite
                ? (current.errorMessage ??
                  'Cancellation arrived after the direct rewrite was written')
                : null
              : current.errorMessage,
          status: input.status,
          terminalAt: current.terminalAt ?? currentTime,
          updatedAt: currentTime,
          version: sql`${documentRewriteRequests.version} + 1`,
          claimOwner: null,
          claimedAt: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(documentRewriteRequests.id, requestId),
            eq(documentRewriteRequests.attempt, input.attempt),
            eq(documentRewriteRequests.status, current.status),
            this.scope(),
          ),
        )
        .returning();
      if (request) return { isDuplicate: false, request };
      const raced = await this.findScoped(requestId, tx);
      return raced && raced.status === input.status
        ? { isDuplicate: true, request: raced }
        : undefined;
    });
  };

  /**
   * Reconcile review rows left behind by a crashed worker or lost browser
   * callback. Pending review deliberately remains visible while it is within
   * the grace period; after expiry/timeout it becomes an explicit stale row so
   * its target reservation cannot block future requests forever.
   */
  async sweepPendingReviews(
    options: {
      maxAgeMs?: number;
      now?: Date;
    } = {},
  ): Promise<number> {
    const currentTime = options.now ?? now();
    const maxAgeMs = Math.min(
      Math.max(
        Number.isFinite(options.maxAgeMs)
          ? Math.trunc(options.maxAgeMs as number)
          : DOCUMENT_REWRITE_REVIEW_SWEEP_DEFAULT_MAX_AGE_MS,
        1,
      ),
      7 * 24 * 60 * 60_000,
    );
    const cutoff = new Date(currentTime.getTime() - maxAgeMs);

    return this.db.transaction(async (tx) => {
      const candidates = await tx
        .select({
          attempt: documentRewriteRequests.attempt,
          documentId: documentRewriteRequests.documentId,
          expiresAt: documentRewriteRequests.expiresAt,
          id: documentRewriteRequests.id,
          status: documentRewriteRequests.status,
          updatedAt: documentRewriteRequests.updatedAt,
        })
        .from(documentRewriteRequests)
        .where(
          and(
            this.scope(),
            inArray(documentRewriteRequests.status, ['awaiting_review', 'canceled_after_write']),
            or(
              lte(documentRewriteRequests.updatedAt, cutoff),
              lte(documentRewriteRequests.expiresAt, currentTime),
            ),
          ),
        )
        .orderBy(asc(documentRewriteRequests.updatedAt), asc(documentRewriteRequests.id))
        .limit(200);
      let swept = 0;

      for (const candidate of candidates) {
        await this.lockDocument(candidate.documentId, tx);
        const [current] = await tx
          .select()
          .from(documentRewriteRequests)
          .where(and(eq(documentRewriteRequests.id, candidate.id), this.scope()))
          .for('update');
        if (
          !current ||
          current.attempt !== candidate.attempt ||
          (current.status !== 'awaiting_review' && current.status !== 'canceled_after_write')
        ) {
          continue;
        }

        const expired = current.expiresAt && current.expiresAt.getTime() <= currentTime.getTime();
        const errorCode = expired ? 'REVIEW_EXPIRED' : 'REVIEW_RECOVERY_TIMEOUT';
        const errorMessage = expired
          ? 'Rewrite review expired before Accept/Reject was recorded.'
          : 'Rewrite review timed out without a durable Accept/Reject proof.';
        const [updated] = await tx
          .update(documentRewriteRequests)
          .set({
            claimOwner: null,
            claimedAt: null,
            errorCode,
            errorMessage,
            leaseExpiresAt: null,
            status: 'stale',
            terminalAt: currentTime,
            updatedAt: currentTime,
            version: sql`${documentRewriteRequests.version} + 1`,
          })
          .where(
            and(
              eq(documentRewriteRequests.id, current.id),
              eq(documentRewriteRequests.attempt, current.attempt),
              inArray(documentRewriteRequests.status, ['awaiting_review', 'canceled_after_write']),
              this.scope(),
            ),
          )
          .returning({ id: documentRewriteRequests.id });
        if (updated) swept += 1;
      }
      return swept;
    });
  }

  cancel = async (
    id: string,
    input: CancelDocumentRewriteRequestInput = {},
  ): Promise<DocumentRewriteTransitionResult | undefined> => {
    const requestId = normalizeString(id, 'id');
    if (input.attempt !== undefined && (!Number.isInteger(input.attempt) || input.attempt < 1)) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: attempt`);
    }
    return this.db.transaction(async (tx) => {
      // Lock the request row so a cancellation observes the latest worker or
      // review transition instead of reporting a false duplicate after a
      // concurrent status change.
      const [current] = await tx
        .select()
        .from(documentRewriteRequests)
        .where(and(eq(documentRewriteRequests.id, requestId), this.scope()))
        .for('update');
      if (!current) return undefined;
      if (input.attempt !== undefined && current.attempt !== input.attempt) return undefined;
      if (
        isDocumentRewriteTerminal(current.status) ||
        current.status === 'awaiting_review' ||
        current.status === 'cancel_requested'
      ) {
        return { isDuplicate: true, request: current };
      }

      const nextStatus =
        current.status === 'queued' || current.status === 'retry_wait'
          ? 'canceled'
          : 'cancel_requested';
      const currentTime = now();
      const [request] = await tx
        .update(documentRewriteRequests)
        .set({
          cancelRequestedAt: current.cancelRequestedAt ?? currentTime,
          status: nextStatus,
          terminalAt: nextStatus === 'canceled' ? currentTime : null,
          updatedAt: currentTime,
          version: sql`${documentRewriteRequests.version} + 1`,
        })
        .where(
          and(
            eq(documentRewriteRequests.id, requestId),
            eq(documentRewriteRequests.status, current.status),
            eq(documentRewriteRequests.attempt, current.attempt),
            this.scope(),
          ),
        )
        .returning();
      return request ? { isDuplicate: false, request } : { isDuplicate: true, request: current };
    });
  };

  retry = async (
    id: string,
    input: RetryDocumentRewriteRequestInput,
  ): Promise<DocumentRewriteTransitionResult | undefined> => {
    const requestId = normalizeString(id, 'id');
    if (!Number.isInteger(input.attempt) || input.attempt < 1) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: attempt`);
    }
    if (
      input.delayMs !== undefined &&
      (!Number.isFinite(input.delayMs) || !Number.isInteger(input.delayMs))
    ) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: delayMs`);
    }
    const delayMs = Math.min(Math.max(Math.trunc(input.delayMs ?? 0), 0), 24 * 60 * 60_000);
    return this.db.transaction(async (tx) => {
      const initial = await this.findScoped(requestId, tx);
      if (!initial || initial.attempt !== input.attempt) return undefined;
      await this.lockDocument(initial.documentId, tx);
      const current = await this.findScoped(requestId, tx);
      if (!current || current.attempt !== input.attempt) return undefined;
      if (!canRetryDocumentRewrite(current.status)) {
        throw new Error(`${DOCUMENT_REWRITE_REQUEST_CONFLICT}: retry status=${current.status}`);
      }
      await this.assertTargetAvailable(
        tx,
        current.documentId,
        current.selection,
        current.targetNodeIds,
        current.id,
      );
      await this.assertRequestCapacityAvailable(tx, current.documentId, current.id);
      const currentTime = now();
      const [request] = await tx
        .update(documentRewriteRequests)
        .set({
          attempt: current.attempt + 1,
          cancelRequestedAt: null,
          claimOwner: null,
          claimedAt: null,
          errorCode: null,
          errorMessage: null,
          generationId: null,
          lastCommandId: null,
          leaseExpiresAt: null,
          model: null,
          nextAttemptAt: new Date(currentTime.getTime() + delayMs),
          progress: null,
          provider: null,
          status: 'retry_wait',
          terminalAt: null,
          updatedAt: currentTime,
          version: sql`${documentRewriteRequests.version} + 1`,
        })
        .where(
          and(
            eq(documentRewriteRequests.id, requestId),
            eq(documentRewriteRequests.status, current.status),
            eq(documentRewriteRequests.attempt, input.attempt),
            this.scope(),
          ),
        )
        .returning();
      if (request) return { isDuplicate: false, request };
      const raced = await this.findScoped(requestId, tx);
      return raced ? { isDuplicate: true, request: raced } : undefined;
    });
  };

  /**
   * Atomically move a live worker attempt to a new retry attempt.
   *
   * Unlike the browser-facing `retry`, this operation is allowed from a
   * transient worker state and keeps `retry_wait` in the target-hold set. That
   * matters for overlapping ranges: a failed worker must not briefly release
   * its target before the next attempt is reserved. The lease owner and
   * attempt are both compare-and-set guards, so a late provider error cannot
   * schedule a retry after another worker or the user has settled the row.
   */
  retryWorker = async (
    id: string,
    input: RetryDocumentRewriteWorkerInput,
  ): Promise<DocumentRewriteTransitionResult | undefined> => {
    const requestId = normalizeString(id, 'id');
    const workerId = normalizeString(input.workerId, 'workerId');
    if (!Number.isInteger(input.attempt) || input.attempt < 1) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: attempt`);
    }
    if (
      input.delayMs !== undefined &&
      (!Number.isFinite(input.delayMs) || !Number.isInteger(input.delayMs))
    ) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: delayMs`);
    }
    const delayMs = Math.min(Math.max(Math.trunc(input.delayMs ?? 0), 0), 24 * 60 * 60_000);

    return this.db.transaction(async (tx) => {
      const initial = await this.findScoped(requestId, tx);
      if (!initial || initial.attempt !== input.attempt) return undefined;
      await this.lockDocument(initial.documentId, tx);
      const current = await this.findScoped(requestId, tx);
      if (!current || current.attempt !== input.attempt) return undefined;

      const currentTime = now();
      if (
        !DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES.includes(
          current.status as (typeof DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES)[number],
        ) ||
        current.claimOwner !== workerId ||
        !current.leaseExpiresAt ||
        current.leaseExpiresAt.getTime() <= currentTime.getTime()
      ) {
        return undefined;
      }
      if (current.cancelRequestedAt || current.status === 'cancel_requested') return undefined;
      if (current.expiresAt && current.expiresAt.getTime() <= currentTime.getTime()) {
        await this.markExpired(requestId, input.attempt, currentTime, tx);
        return undefined;
      }
      await this.assertRequestCapacityAvailable(tx, current.documentId, current.id);

      const [request] = await tx
        .update(documentRewriteRequests)
        .set({
          attempt: current.attempt + 1,
          cancelRequestedAt: null,
          claimOwner: null,
          claimedAt: null,
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
          generationId: null,
          lastCommandId: null,
          leaseExpiresAt: null,
          model: null,
          nextAttemptAt: new Date(currentTime.getTime() + delayMs),
          progress: null,
          provider: null,
          status: 'retry_wait',
          terminalAt: null,
          updatedAt: currentTime,
          version: sql`${documentRewriteRequests.version} + 1`,
        })
        .where(
          and(
            eq(documentRewriteRequests.id, requestId),
            eq(documentRewriteRequests.attempt, input.attempt),
            eq(documentRewriteRequests.claimOwner, workerId),
            inArray(documentRewriteRequests.status, DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES),
            gt(documentRewriteRequests.leaseExpiresAt, currentTime),
            this.scope(),
          ),
        )
        .returning();

      if (request) return { isDuplicate: false, request };
      const raced = await this.findScoped(requestId, tx);
      if (!raced) return undefined;
      if (raced.attempt > input.attempt && raced.status === 'retry_wait') {
        return { isDuplicate: true, request: raced };
      }
      return undefined;
    });
  };

  /** Move a due retry into the normal queue without claiming it. */
  promoteRetry = async (
    id: string,
    attempt: number,
  ): Promise<DocumentRewriteRequestItem | undefined> => {
    const requestId = normalizeString(id, 'id');
    if (!Number.isInteger(attempt) || attempt < 1) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: attempt`);
    }
    return this.db.transaction(async (tx) => {
      const initial = await this.findScoped(requestId, tx);
      if (!initial || initial.attempt !== attempt) return undefined;
      await this.lockDocument(initial.documentId, tx);
      const current = await this.findScoped(requestId, tx);
      if (!current || current.attempt !== attempt || current.status !== 'retry_wait') {
        return undefined;
      }
      const currentTime = now();
      if (current.nextAttemptAt && current.nextAttemptAt.getTime() > currentTime.getTime()) {
        return undefined;
      }
      // retry_wait already holds a slot, but re-checking under the same lock
      // prevents an over-capacity legacy row from being promoted as a fresh
      // queue delivery and keeps this path consistent with claim/retry.
      await this.assertRequestCapacityAvailable(tx, current.documentId, current.id);
      const [request] = await tx
        .update(documentRewriteRequests)
        .set({
          nextAttemptAt: null,
          status: 'queued',
          updatedAt: currentTime,
          version: sql`${documentRewriteRequests.version} + 1`,
        })
        .where(
          and(
            eq(documentRewriteRequests.id, requestId),
            eq(documentRewriteRequests.attempt, attempt),
            eq(documentRewriteRequests.status, 'retry_wait'),
            this.scope(),
          ),
        )
        .returning();
      return request;
    });
  };

  /** Requests ready for a worker; no caller-provided room ticket is returned. */
  listRunnable = async (limit = 50): Promise<DocumentRewriteRequestItem[]> => {
    const rows = await this.db
      .select()
      .from(documentRewriteRequests)
      .where(
        and(
          this.scope(),
          // Include rows whose active worker lease expired. A process crash
          // can leave connecting/syncing/thinking/writing behind; the next
          // process must redeliver the same attempt so `claim` can take it
          // over (or mark it canceled/stale) instead of leaving it stuck.
          or(
            eq(documentRewriteRequests.status, 'queued'),
            and(
              eq(documentRewriteRequests.status, 'retry_wait'),
              or(
                isNull(documentRewriteRequests.nextAttemptAt),
                lte(documentRewriteRequests.nextAttemptAt, now()),
              ),
            ),
            and(
              inArray(documentRewriteRequests.status, DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES),
              or(
                isNull(documentRewriteRequests.leaseExpiresAt),
                lte(documentRewriteRequests.leaseExpiresAt, now()),
              ),
            ),
          ),
        ),
      )
      .orderBy(asc(documentRewriteRequests.createdAt), asc(documentRewriteRequests.id))
      .limit(Math.min(Math.max(limit, 1), 200));
    return rows.map(sanitizeRequestProgress);
  };
}
