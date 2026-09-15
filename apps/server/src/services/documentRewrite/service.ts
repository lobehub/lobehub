import { LOADING_FLAT } from '@lobechat/const';
import { createHeadlessEditor } from '@lobehub/editor/headless';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { DocumentModel } from '@/database/models/document';
import type {
  ClaimDocumentRewriteRequestInput,
  CreateDocumentRewriteRequestInput,
  DeleteDocumentRewriteSessionInput,
  DeleteDocumentRewriteSessionResult,
  DocumentRewriteDirectApplyInput,
  DocumentRewriteRequestResult,
  DocumentRewriteTransitionResult,
  RenewDocumentRewriteLeaseInput,
  RetryDocumentRewriteRequestInput,
  TransitionDocumentRewriteRequestInput,
  UpdateDocumentRewriteProgressInput,
} from '@/database/models/documentRewriteRequest';
import {
  DOCUMENT_REWRITE_REQUEST_NOT_CLAIMED,
  DOCUMENT_REWRITE_REQUEST_NOT_FOUND,
  DOCUMENT_REWRITE_REVIEW_PROOF_INVALID,
  DocumentRewriteRequestModel,
} from '@/database/models/documentRewriteRequest';
import {
  hashRewriteText,
  normalizeRewriteText,
} from '@/database/models/documentRewriteRequest.validation';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import type {
  DocumentRewriteRequestItem,
  DocumentRewriteRequestStatus,
} from '@/database/schemas/documentRewriteRequest';
import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';

import { assertDocumentRewriteCreationEnabled } from './featureGate';
import { canonicalizeGeneratedMarkdownProof } from './proof';
import type { DocumentRewriteQueue } from './queue';
import {
  consumeDocumentRewriteRoomTicket,
  DOCUMENT_REWRITE_ROOM_TICKET_DEFAULT_TTL_MS,
  DOCUMENT_REWRITE_ROOM_TICKET_INVALID,
  type DocumentRewriteRoomTicketClaims,
  type DocumentRewriteRoomTicketService,
  issueDocumentRewriteRoomTicket,
} from './roomTicket';
import { DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES, isDocumentRewriteTerminal } from './stateMachine';

export const DOCUMENT_REWRITE_REVIEW_ONLY_STATUS = 'DOCUMENT_REWRITE_REVIEW_ONLY_STATUS' as const;

const isDocumentRewriteOperationTerminal = (status: DocumentRewriteRequestStatus): boolean =>
  ['applied', 'canceled', 'canceled_after_write', 'failed', 'rejected', 'stale'].includes(status);

const DOCUMENT_REWRITE_TOPIC_TARGET_SOURCE_MAX_BYTES = 1_048_576;
const DOCUMENT_REWRITE_TARGET_LANGUAGE_MAX_LENGTH = 64;

export interface EnsureDocumentRewriteTargetContext {
  adapterId: string;
  language?: string;
  nodeId: string;
  nodeType: string;
  outputSchema: 'patch' | 'source';
  source: string;
  sourceHash: string;
  title?: string;
}

export interface DocumentRewriteRequestServiceOptions {
  /** Editor-owned complete Markdown proof for direct request output. */
  canonicalizeRewriteProof?: (
    editorData: unknown,
    outputText: string,
    persistedText?: string,
  ) => boolean;
  /** Editor-owned Markdown projection used for legacy continuation rows. */
  canonicalizeRewriteText?: (text: string) => string;
  /** Editor-owned capture projection used for a continuation child selection. */
  captureRewriteText?: (text: string) => string;
  onQueueError?: (error: unknown, request: DocumentRewriteRequestItem) => void;
  /** Optional post-commit delivery adapter; DB state remains authoritative. */
  queue?: DocumentRewriteQueue;
}

const getSerializedTextContent = (node: unknown, seen = new WeakSet<object>()): string => {
  if (typeof node !== 'object' || node === null || seen.has(node)) return '';
  seen.add(node);
  if (Array.isArray(node))
    return node.map((child) => getSerializedTextContent(child, seen)).join('');

  const record = node as { children?: unknown; text?: unknown; type?: unknown };
  if (record.type === 'cursor') return '';
  if (typeof record.text === 'string') return record.text;
  return getSerializedTextContent(record.children, seen);
};

const CAPTURE_TEXT_CONTAINERS = new Set(['blockquote', 'collapsible', 'list', 'root']);

const getSerializedCaptureText = (node: unknown, seen = new WeakSet<object>()): string => {
  if (typeof node !== 'object' || node === null || seen.has(node)) return '';
  seen.add(node);
  if (Array.isArray(node))
    return node.map((child) => getSerializedCaptureText(child, seen)).join('');

  const record = node as { children?: unknown; text?: unknown; type?: unknown };
  if (record.type === 'cursor') return '';
  if (typeof record.text === 'string') return record.text;
  if (!Array.isArray(record.children)) return '';
  const separator = CAPTURE_TEXT_CONTAINERS.has(String(record.type)) ? ' ' : '';
  return record.children
    .map((child) => getSerializedCaptureText(child, seen))
    .filter(Boolean)
    .join(separator);
};

const canonicalizeLegacyRewriteText = (text: string): string => {
  const editor = createHeadlessEditor();
  try {
    editor.hydrateMarkdown(text);
    return getSerializedTextContent(editor.export().editorData.root);
  } finally {
    editor.destroy();
  }
};

const captureLegacyRewriteText = (text: string): string => {
  const editor = createHeadlessEditor();
  try {
    editor.hydrateMarkdown(text);
    return normalizeRewriteText(getSerializedCaptureText(editor.export().editorData.root));
  } finally {
    editor.destroy();
  }
};

export interface EnqueueDocumentRewriteRequestInput {
  /** Optional instruction replacement; legal only while the row is queued. */
  instruction?: string;
}

export interface EnsureDocumentRewriteTopicTurnInput {
  agentId: string;
  attempt: number;
  documentId?: string;
  instruction: string;
  model?: string | null;
  operationId?: string | null;
  provider?: string | null;
  requestId: string;
  sessionId?: string | null;
  status?: DocumentRewriteRequestItem['status'];
  /** Server-resolved source from the collaborative adapter, never client input. */
  targetContext?: EnsureDocumentRewriteTargetContext;
  topicId?: string | null;
}

export interface EnsureDocumentRewriteTopicTurnResult {
  assistantMessageId: string;
  topicId: string;
  userMessageId: string;
}

export type DocumentRewriteRetryDeliveryStatus = 'enqueue_failed' | 'enqueued' | 'recovery_pending';

export type DocumentRewriteRetryResult = DocumentRewriteTransitionResult & {
  /** Whether the new attempt was handed to the queue or remains scanner-recoverable. */
  deliveryStatus?: DocumentRewriteRetryDeliveryStatus;
};

export const DOCUMENT_REWRITE_TARGET_CONTEXT_INVALID = 'DOCUMENT_REWRITE_TARGET_CONTEXT_INVALID';

const utf8ByteLength = (value: string): number =>
  typeof TextEncoder === 'undefined'
    ? Buffer.byteLength(value, 'utf8')
    : new TextEncoder().encode(value).byteLength;

const normalizeTargetContext = (
  value: EnsureDocumentRewriteTargetContext | undefined,
): EnsureDocumentRewriteTargetContext | undefined => {
  if (!value) return undefined;
  if (
    typeof value.adapterId !== 'string' ||
    value.adapterId.trim().length === 0 ||
    typeof value.nodeId !== 'string' ||
    value.nodeId.trim().length === 0 ||
    typeof value.nodeType !== 'string' ||
    value.nodeType.trim().length === 0 ||
    (value.outputSchema !== 'source' && value.outputSchema !== 'patch') ||
    typeof value.source !== 'string' ||
    typeof value.sourceHash !== 'string' ||
    value.sourceHash.trim().length === 0 ||
    utf8ByteLength(value.source) > DOCUMENT_REWRITE_TOPIC_TARGET_SOURCE_MAX_BYTES ||
    hashRewriteText(value.source) !== value.sourceHash
  ) {
    throw new Error(DOCUMENT_REWRITE_TARGET_CONTEXT_INVALID);
  }
  if (
    value.language !== undefined &&
    (typeof value.language !== 'string' ||
      value.language.trim().length === 0 ||
      value.language.length > DOCUMENT_REWRITE_TARGET_LANGUAGE_MAX_LENGTH)
  ) {
    throw new Error(DOCUMENT_REWRITE_TARGET_CONTEXT_INVALID);
  }
  if (
    value.title !== undefined &&
    (typeof value.title !== 'string' || value.title.trim().length === 0 || value.title.length > 255)
  ) {
    throw new Error(DOCUMENT_REWRITE_TARGET_CONTEXT_INVALID);
  }
  return {
    adapterId: value.adapterId.trim(),
    ...(value.language ? { language: value.language.trim() } : {}),
    nodeId: value.nodeId.trim(),
    nodeType: value.nodeType.trim(),
    outputSchema: value.outputSchema,
    source: value.source,
    sourceHash: value.sourceHash.trim(),
    ...(value.title === undefined ? {} : { title: value.title.trim() }),
  };
};

/**
 * Keep the authorized instruction and the server-resolved target source
 * explicit in the ordinary topic user message. The source is untrusted
 * document data; its hash/identity are persisted only as proof metadata and
 * arbitrary source fields are never accepted from the browser request.
 */
const buildTopicTurnContent = (
  instruction: string,
  targetContext: EnsureDocumentRewriteTargetContext | undefined,
): string => {
  if (!targetContext) return instruction;
  return [
    '<document_rewrite_turn>',
    '<authorized_rewrite_instruction>',
    instruction,
    '</authorized_rewrite_instruction>',
    '<selected_target_context>',
    `adapter_id=${JSON.stringify(targetContext.adapterId)}`,
    ...(targetContext.language ? [`language=${JSON.stringify(targetContext.language)}`] : []),
    `node_id=${JSON.stringify(targetContext.nodeId)}`,
    `node_type=${JSON.stringify(targetContext.nodeType)}`,
    `output_schema=${JSON.stringify(targetContext.outputSchema)}`,
    `source_hash=${JSON.stringify(targetContext.sourceHash)}`,
    '<source>',
    targetContext.source,
    '</source>',
    '</selected_target_context>',
    '</document_rewrite_turn>',
  ].join('\n');
};

let configuredQueue: DocumentRewriteQueue | undefined;
let configuredQueueErrorHandler: DocumentRewriteRequestServiceOptions['onQueueError'];
const successfulQueueDeliveries = new WeakMap<DocumentRewriteQueue, Set<string>>();

/** Configure the process-local composition root used by request creation. */
export const configureDocumentRewriteQueue = (
  queue: DocumentRewriteQueue | undefined,
  onQueueError?: DocumentRewriteRequestServiceOptions['onQueueError'],
): void => {
  configuredQueue = queue;
  configuredQueueErrorHandler = onQueueError;
};

export const getConfiguredDocumentRewriteQueue = (): DocumentRewriteQueue | undefined =>
  configuredQueue;

/**
 * Create the DB-backed authorization callback used by the room ticket
 * verifier. It revalidates the request and worker lease at auth time, so a
 * self-contained ticket cannot outlive a takeover, cancellation, expiry, or
 * user/document scope change. Database/ACL errors fail closed.
 */
export interface DatabaseDocumentRewriteTicketAuthorizerOptions {
  authorizeAgent?: (input: {
    agentId: string;
    db: LobeChatDatabase;
    userId: string;
    workspaceId: string | null;
  }) => boolean | Promise<boolean> | void | Promise<void>;
  authorizeDocumentEdit?: (input: {
    db: LobeChatDatabase;
    documentId: string;
    userId: string;
    workspaceId: string | null;
  }) => boolean | Promise<boolean> | void | Promise<void>;
}

const defaultAuthorizeDocumentEdit = async (input: {
  db: LobeChatDatabase;
  documentId: string;
  userId: string;
  workspaceId: string | null;
}): Promise<void> => {
  if (input.workspaceId) {
    await assertCanPerformResourceAction({
      action: 'edit',
      db: input.db,
      resourceId: input.documentId,
      resourceType: 'document',
      userId: input.userId,
      workspaceId: input.workspaceId,
    });
    return;
  }
  const document = await new DocumentModel(input.db, input.userId).findById(input.documentId);
  if (!document) throw new Error('Document rewrite document edit access denied');
};

const defaultAuthorizeAgent = async (input: {
  agentId: string;
  db: LobeChatDatabase;
  userId: string;
  workspaceId: string | null;
}): Promise<void> => {
  await assertAgentUsableBy(input.db, input.agentId, {
    userId: input.userId,
    workspaceId: input.workspaceId ?? undefined,
  });
};

export const createDatabaseDocumentRewriteTicketAuthorizer =
  (db: LobeChatDatabase, options: DatabaseDocumentRewriteTicketAuthorizerOptions = {}) =>
  async (claims: DocumentRewriteRoomTicketClaims): Promise<boolean> => {
    if (!claims.workerId) return false;
    try {
      // Re-check the document-owned five-request capacity under the same
      // request scope used for normal lifecycle mutations. This keeps a
      // caller from turning a stale/hand-written ticket into a sixth Agent
      // connection after creation has already filled the document slots.
      const requestModel = new DocumentRewriteRequestModel(db, claims.userId, claims.workspaceId);
      // Production databases expose transactions, which makes the capacity
      // check share the document lock with request creation. Keep the small
      // findById fallback for lightweight authorization doubles used by
      // embedders/tests; those callers cannot provide a lock to assert.
      const request =
        typeof (db as { transaction?: unknown }).transaction === 'function'
          ? await requestModel.assertCapacityForRequest(claims.requestId, claims.attempt)
          : await requestModel.findById(claims.requestId);
      if (!request) return false;
      if (
        request.documentId !== claims.documentId ||
        request.agentId !== claims.agentId ||
        request.attempt !== claims.attempt ||
        request.requestedByUserId !== claims.userId ||
        request.claimOwner !== claims.workerId
      ) {
        return false;
      }
      if (
        request.workspaceId !== claims.workspaceId ||
        request.documentId !== claims.roomId ||
        request.selection.roomId !== claims.roomId
      ) {
        return false;
      }
      if (
        request.status === 'cancel_requested' ||
        !(DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES as readonly string[]).includes(request.status)
      ) {
        return false;
      }
      const nowMs = Date.now();
      if (!request.leaseExpiresAt || request.leaseExpiresAt.getTime() <= nowMs) return false;
      if (request.expiresAt && request.expiresAt.getTime() <= nowMs) return false;
      const documentEditAuthorized = await (
        options.authorizeDocumentEdit ?? defaultAuthorizeDocumentEdit
      )({
        db,
        documentId: claims.documentId,
        userId: claims.userId,
        workspaceId: claims.workspaceId,
      });
      if (documentEditAuthorized === false) return false;
      const agentAuthorized = await (options.authorizeAgent ?? defaultAuthorizeAgent)({
        agentId: claims.agentId,
        db,
        userId: claims.userId,
        workspaceId: claims.workspaceId,
      });
      if (agentAuthorized === false) return false;
      return true;
    } catch {
      return false;
    }
  };

export interface DocumentRewriteRoomTicketAuthorizationInput {
  authorize: (claims: DocumentRewriteRoomTicketClaims) => boolean | Promise<boolean>;
  ticketService?: DocumentRewriteRoomTicketService;
}

export interface DocumentRewriteRoomTicketVerifierInput {
  clientId?: number;
  clientKind: 'agent' | 'browser';
  documentId?: string;
  requestId?: string;
  roomId: string;
  ticket?: string | null;
  workerId?: string;
}

/**
 * Build the room-server verifier for durable worker tickets. The verifier
 * consumes the single-use HMAC ticket, then invokes a deployment-owned ACL /
 * live-claim callback. Requiring that callback makes an accidentally
 * unconfigured production room fail closed instead of trusting a self-contained
 * token after its DB lease has been taken over.
 */
export const createDocumentRewriteRoomTicketVerifier = (
  options: DocumentRewriteRoomTicketAuthorizationInput,
) => {
  if (typeof options.authorize !== 'function') {
    throw new Error('Document rewrite room ticket authorization callback is required');
  }
  return async (input: DocumentRewriteRoomTicketVerifierInput) => {
    if (input.clientKind !== 'agent' || typeof input.ticket !== 'string') return false;
    try {
      const claims = (
        options.ticketService
          ? options.ticketService.consume(input.ticket, {
              clientKind: input.clientKind,
              documentId: input.documentId,
              requestId: input.requestId,
              roomId: input.roomId,
              workerId: input.workerId,
            })
          : consumeDocumentRewriteRoomTicket(input.ticket, {
              clientKind: input.clientKind,
              documentId: input.documentId,
              requestId: input.requestId,
              roomId: input.roomId,
              workerId: input.workerId,
            })
      ) as DocumentRewriteRoomTicketClaims;
      if (!(await options.authorize(claims))) return false;
      return {
        allowed: true,
        clientId: input.clientId,
        expiresAt: claims.exp,
        principal: {
          agentId: claims.agentId,
          attempt: claims.attempt,
          canWrite: true,
          clientKind: claims.clientKind,
          documentId: claims.documentId,
          requestId: claims.requestId,
          roomId: claims.roomId,
          userId: claims.userId,
          workerId: claims.workerId,
          workspaceId: claims.workspaceId,
        },
        ticketId: claims.nonce,
      };
    } catch {
      return false;
    }
  };
};

/**
 * Narrow server facade for targeted rewrite requests. It deliberately exposes
 * no editor/Yjs/provider methods: the worker owns room access, while this
 * service owns durable request lifecycle and authorization scope.
 */
export class DocumentRewriteRequestService {
  private readonly db: LobeChatDatabase;
  private readonly model: DocumentRewriteRequestModel;
  private readonly operationModel: AgentOperationModel;
  private readonly queue?: DocumentRewriteQueue;
  private readonly onQueueError?: DocumentRewriteRequestServiceOptions['onQueueError'];
  private readonly userId: string;
  private readonly workspaceId?: string | null;

  private completeRewriteOperation = async (
    operationId: string,
    input: TransitionDocumentRewriteRequestInput,
    request: DocumentRewriteRequestItem,
  ): Promise<void> => {
    const failed = input.status === 'failed' || input.status === 'stale';
    const interrupted = input.status === 'canceled' || input.status === 'canceled_after_write';
    try {
      await this.operationModel.recordCompletion(operationId, {
        completedAt: new Date(),
        completionReason: failed ? 'error' : interrupted ? 'interrupted' : 'done',
        error: failed
          ? {
              // Error code/message are already bounded by the request model;
              // do not copy provider response bodies into the operation row.
              message: input.errorMessage ?? input.errorCode ?? undefined,
              type: input.errorCode ?? undefined,
            }
          : undefined,
        model: input.model ?? request.model,
        provider: input.provider ?? request.provider,
        status: failed ? 'error' : interrupted ? 'interrupted' : 'done',
      });
    } catch {
      // The request transition is authoritative. Operation analytics are
      // best-effort so an unrelated audit-row outage cannot re-run a write.
    }
  };

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string | null,
    options: DocumentRewriteRequestServiceOptions = {},
  ) {
    this.db = db;
    this.model = new DocumentRewriteRequestModel(db, userId, workspaceId, {
      canonicalizeRewriteText: options.canonicalizeRewriteText ?? canonicalizeLegacyRewriteText,
      canonicalizeRewriteProof:
        options.canonicalizeRewriteProof ?? canonicalizeGeneratedMarkdownProof,
      captureRewriteText: options.captureRewriteText ?? captureLegacyRewriteText,
    });
    this.operationModel = new AgentOperationModel(db, userId, workspaceId ?? undefined);
    this.queue = options.queue ?? configuredQueue;
    this.onQueueError = options.onQueueError ?? configuredQueueErrorHandler;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  create = async (
    input: CreateDocumentRewriteRequestInput,
  ): Promise<DocumentRewriteRequestResult> => {
    // This gate intentionally lives beside the durable create operation so
    // direct callers cannot bypass the rollback switch by skipping the router.
    // Existing requests, room persistence, and legacy review settlement remain
    // available while creation is disabled.
    assertDocumentRewriteCreationEnabled();
    const result = await this.model.create(input);
    // Materialize the ordinary topic turn immediately after the request
    // transaction. The worker repeats this idempotently after claim so a
    // crashed API process or a legacy caller remains recoverable.
    if (!result.isDuplicate && result.request.topicId) {
      try {
        await this.ensureTopicTurn({
          agentId: result.request.agentId,
          attempt: result.request.attempt,
          documentId: result.request.documentId,
          instruction: result.request.instruction,
          model: result.request.requestedModel ?? result.request.model,
          operationId: result.request.operationId,
          provider: result.request.requestedProvider ?? result.request.provider,
          requestId: result.request.id,
          sessionId: result.request.sessionId,
          status: result.request.status,
          topicId: result.request.topicId,
        });
      } catch {
        // The durable request remains queue/recovery authoritative; the worker
        // retries this idempotent topic materialization before model execution.
      }
    }
    // Schedule only after the transaction has committed. A queue outage must
    // not turn a successfully persisted request into an HTTP failure: the
    // durable queued row is recovered by `DocumentRewriteWorker.recoverRunnable`.
    if (this.queue && !result.isDuplicate) {
      try {
        await this.queue.enqueue({ attempt: result.request.attempt, requestId: result.request.id });
      } catch (error) {
        try {
          this.onQueueError?.(error, result.request);
        } catch {
          // Queue diagnostics must never turn a committed request into a
          // failed API response; the row remains recoverable by the scanner.
        }
      }
    }
    return result;
  };

  /**
   * Re-drive a request that was created by the Page request API.
   *
   * This is intentionally narrower than `create`: callers cannot supply a
   * selection, agent, document, room ticket, or snapshot. The request row is
   * the source of truth and remains scoped to this service's user/workspace.
   * Updating an instruction is delegated to the model's locked queued-only
   * operation, then the tiny `{ requestId, attempt }` message is delivered to
   * the configured durable queue. Repeated calls are idempotent per queue.
   */
  enqueueExisting = async (
    id: string,
    input: EnqueueDocumentRewriteRequestInput = {},
  ): Promise<DocumentRewriteRequestResult> => {
    let request = await this.model.findById(id);
    if (!request) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);

    if (input.instruction !== undefined) {
      const updated = await this.model.updateInstruction(request.id, {
        instruction: input.instruction,
      });
      if (!updated) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);
      request = updated;
    }

    if (this.queue && request.status === 'queued') {
      const key = `${request.id}:${request.attempt}`;
      let delivered = successfulQueueDeliveries.get(this.queue);
      if (!delivered) {
        delivered = new Set<string>();
        successfulQueueDeliveries.set(this.queue, delivered);
      }

      if (!delivered.has(key)) {
        // Set the reservation before awaiting the transport. This coalesces
        // concurrent tool replays; failed delivery removes it so recovery can
        // retry later.
        delivered.add(key);
        try {
          await this.queue.enqueue({ attempt: request.attempt, requestId: request.id });
        } catch (error) {
          delivered.delete(key);
          try {
            this.onQueueError?.(error, request);
          } catch {
            // Diagnostics must never turn the already-persisted request into a
            // failed tool call. The recovery scanner remains authoritative.
          }
        }
      }
    }

    return { isDuplicate: true, request };
  };

  /** Compatibility alias for adapters that call the operation simply `enqueue`. */
  enqueue = (
    id: string,
    input: EnqueueDocumentRewriteRequestInput = {},
  ): Promise<DocumentRewriteRequestResult> => this.enqueueExisting(id, input);

  findById = (id: string): Promise<DocumentRewriteRequestItem | undefined> =>
    this.model.findById(id);

  /**
   * Create the ordinary topic message pair used by the shared chat history.
   * IDs are deterministic per request turn so queue redelivery/retry attempts
   * cannot add a second user/assistant turn to the rewrite topic.
   */
  ensureTopicTurn = async (
    input: EnsureDocumentRewriteTopicTurnInput,
  ): Promise<EnsureDocumentRewriteTopicTurnResult | undefined> => {
    if (!input.topicId) return undefined;
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_NOT_FOUND}: invalid attempt`);
    }

    const messageModel = new MessageModel(this.db, this.userId, this.workspaceId ?? undefined);
    const operationModel = new AgentOperationModel(
      this.db,
      this.userId,
      this.workspaceId ?? undefined,
    );
    const topicModel = new TopicModel(this.db, this.userId, this.workspaceId ?? undefined);
    const targetContext = normalizeTargetContext(input.targetContext);
    const topicMessageContent = buildTopicTurnContent(input.instruction, targetContext);
    // Attempts are delivery retries, not conversation turns. Keep the message
    // identities request-scoped so a retry updates the same assistant row and
    // never appends another user/assistant pair to the topic.
    const userMessageId = `document-rewrite-${input.requestId}-user`;
    const assistantMessageId = `document-rewrite-${input.requestId}-assistant`;
    const metadata = {
      attempt: input.attempt,
      ...(input.documentId ? { documentId: input.documentId } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      requestId: input.requestId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.status ? { status: input.status } : {}),
      scope: 'document_rewrite',
      ...(targetContext
        ? {
            target: {
              adapterId: targetContext.adapterId,
              ...(targetContext.language ? { language: targetContext.language } : {}),
              nodeId: targetContext.nodeId,
              nodeType: targetContext.nodeType,
              outputSchema: targetContext.outputSchema,
              sourceHash: targetContext.sourceHash,
              ...(targetContext.title ? { title: targetContext.title } : {}),
            },
          }
        : {}),
    };

    if (input.operationId) {
      await operationModel.recordStart({
        agentId: input.agentId,
        appContext: {
          ...(input.documentId ? { documentId: input.documentId } : {}),
          scope: 'document_rewrite',
          sessionId: input.sessionId ?? undefined,
          sourceMessageId: userMessageId,
        },
        metadata,
        model: input.model ?? undefined,
        operationId: input.operationId,
        provider: input.provider ?? undefined,
        topicId: input.topicId,
        trigger: 'document_rewrite',
      });
    }

    // Keep the topic's ordinary model pin in sync with the selected turn. This
    // is a display/audit snapshot only; the Agent default remains untouched.
    if (input.model || input.provider) {
      await topicModel.update(input.topicId, {
        ...(input.model ? { model: input.model } : {}),
        ...(input.provider ? { provider: input.provider } : {}),
      });
    }

    let userMessage = await messageModel.findById(userMessageId);
    if (!userMessage) {
      const parentId =
        (await messageModel.getLatestSpineMessageId({ topicId: input.topicId })) ??
        (await messageModel.getLatestNonToolMessageId({ topicId: input.topicId }));
      try {
        userMessage = await messageModel.create(
          {
            agentId: input.agentId,
            content: topicMessageContent,
            metadata,
            model: input.model ?? undefined,
            parentId,
            role: 'user',
            provider: input.provider ?? undefined,
            topicId: input.topicId,
          },
          userMessageId,
        );
      } catch {
        userMessage = await messageModel.findById(userMessageId);
        if (!userMessage) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);
      }
    }

    let assistantMessage = await messageModel.findById(assistantMessageId);
    if (!assistantMessage) {
      try {
        assistantMessage = await messageModel.create(
          {
            agentId: input.agentId,
            content: LOADING_FLAT,
            metadata,
            model: input.model ?? undefined,
            parentId: userMessage.id,
            provider: input.provider ?? undefined,
            role: 'assistant',
            topicId: input.topicId,
          },
          assistantMessageId,
        );
      } catch {
        assistantMessage = await messageModel.findById(assistantMessageId);
        if (!assistantMessage) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);
      }
    } else {
      // Keep the user turn's selected model/provider and target proof current
      // across retries. The message id stays stable, while the content is
      // replaced only when the worker has supplied a newly verified target
      // source from the collaboration room.
      await messageModel.update(userMessageId, {
        ...(targetContext && userMessage.content !== topicMessageContent
          ? { content: topicMessageContent }
          : {}),
        metadata,
        model: input.model ?? undefined,
        provider: input.provider ?? undefined,
      });
      // A later automatic/manual retry reuses this assistant placeholder. Reset
      // only this row's generated content and merge the bounded attempt/model
      // metadata; the original user message remains the single conversation
      // turn shown by the topic UI.
      await messageModel.update(assistantMessageId, {
        content: LOADING_FLAT,
        metadata,
        model: input.model ?? undefined,
        provider: input.provider ?? undefined,
      });
    }

    return {
      assistantMessageId: assistantMessage.id,
      topicId: input.topicId,
      userMessageId: userMessage.id,
    };
  };

  /** Create a new turn from an applied parent request. */
  continue = async (
    parentRequestId: string,
    input: { instruction: string; model?: string | null; provider?: string | null },
  ): Promise<DocumentRewriteRequestResult | undefined> => {
    assertDocumentRewriteCreationEnabled();
    const result = await this.model.continue(parentRequestId, input);
    if (result && !result.isDuplicate && result.request.topicId) {
      try {
        await this.ensureTopicTurn({
          agentId: result.request.agentId,
          attempt: result.request.attempt,
          documentId: result.request.documentId,
          instruction: result.request.instruction,
          model: result.request.requestedModel ?? result.request.model,
          operationId: result.request.operationId,
          provider: result.request.requestedProvider ?? result.request.provider,
          requestId: result.request.id,
          sessionId: result.request.sessionId,
          status: result.request.status,
          topicId: result.request.topicId,
        });
      } catch {
        // Let worker recovery retry the topic turn without losing the queued
        // continuation that has already committed.
      }
    }
    if (result && this.queue && !result.isDuplicate) {
      try {
        await this.queue.enqueue({ attempt: result.request.attempt, requestId: result.request.id });
      } catch (error) {
        try {
          this.onQueueError?.(error, result.request);
        } catch {
          // The durable row remains recoverable by the scanner.
        }
      }
    }
    return result;
  };

  list = (options?: {
    documentId?: string;
    limit?: number;
    statuses?: DocumentRewriteRequestStatus[];
  }): Promise<DocumentRewriteRequestItem[]> => this.model.list(options);

  deleteSession = (
    input: DeleteDocumentRewriteSessionInput,
  ): Promise<DeleteDocumentRewriteSessionResult | undefined> => this.model.deleteSession(input);

  /** Worker claim; request/attempt and lease checks are performed atomically by the model. */
  claim = (
    id: string,
    input: ClaimDocumentRewriteRequestInput,
  ): Promise<DocumentRewriteRequestItem | undefined> => this.model.claim(id, input);

  renewLease = (
    id: string,
    input: RenewDocumentRewriteLeaseInput,
  ): Promise<DocumentRewriteRequestItem | undefined> => this.model.renewLease(id, input);

  /** Worker-only bounded progress projection; raw model reasoning never enters the row. */
  updateProgress = (
    id: string,
    input: UpdateDocumentRewriteProgressInput,
  ): Promise<DocumentRewriteRequestItem | undefined> => this.model.updateProgress(id, input);

  /**
   * Worker-only transition. The model requires a live worker lease and rejects
   * calls without workerId, including stale/incorrect attempts.
   */
  transitionWorker = async (
    id: string,
    input: TransitionDocumentRewriteRequestInput & { workerId: string },
  ): Promise<DocumentRewriteTransitionResult | undefined> => {
    if (input.status === 'applied' || input.status === 'rejected') {
      throw new Error(DOCUMENT_REWRITE_REVIEW_ONLY_STATUS);
    }
    const result = await this.model.transition(id, input);
    if (result && isDocumentRewriteOperationTerminal(input.status) && result.request.operationId) {
      await this.completeRewriteOperation(result.request.operationId, input, result.request);
    }
    return result;
  };

  /**
   * Worker-only direct settlement. The model accepts this transition only when
   * the room collaboration ledger and the request-linked agent history row
   * prove that the command is durable. It intentionally has no browser/API
   * counterpart: new targeted rewrites are applied automatically.
   */
  markDirectApplied = async (
    id: string,
    input: DocumentRewriteDirectApplyInput,
  ): Promise<DocumentRewriteTransitionResult | undefined> => {
    const result = await this.model.markDirectApplied(id, input);
    if (result?.request.operationId) {
      try {
        await this.operationModel.recordCompletion(result.request.operationId, {
          completedAt: new Date(),
          completionReason: 'done',
          model: input.model,
          provider: input.provider,
          status: 'done',
        });
      } catch {
        // The request transition is authoritative; analytics are best effort.
      }
    }
    return result;
  };

  /** Compatibility-only browser/user Accept or Reject path for legacy rows. */
  settleReview = (
    id: string,
    input: {
      attempt: number;
      expectedCommandId?: string | null;
      stateVector: string;
      status: 'applied' | 'rejected';
    },
  ): Promise<DocumentRewriteTransitionResult | undefined> => {
    if (!input.stateVector?.trim()) {
      throw new Error(`${DOCUMENT_REWRITE_REVIEW_PROOF_INVALID}: stateVector required`);
    }
    return this.model.settleReview(id, {
      ...input,
      proof: { stateVector: input.stateVector.trim() },
    });
  };

  cancel = (
    id: string,
    input?: { attempt?: number },
  ): Promise<DocumentRewriteTransitionResult | undefined> => this.model.cancel(id, input);

  retry = async (
    id: string,
    input: RetryDocumentRewriteRequestInput,
  ): Promise<DocumentRewriteRetryResult | undefined> => {
    const result = await this.model.retry(id, input);
    if (!result || result.isDuplicate) return result;
    if (!this.queue) return { ...result, deliveryStatus: 'recovery_pending' };

    const message = { attempt: result.request.attempt, requestId: result.request.id };
    try {
      if (input.delayMs === undefined) await this.queue.enqueue(message);
      else await this.queue.enqueue(message, { delayMs: input.delayMs });
      return { ...result, deliveryStatus: 'enqueued' };
    } catch (error) {
      // The durable retry_wait row remains recoverable by the startup/recovery
      // scanner. Surface the delivery failure explicitly instead of returning
      // a misleading "started" state to the caller.
      try {
        this.onQueueError?.(error, result.request);
      } catch {
        // Queue diagnostics must never turn a committed retry into an API
        // failure; deliveryStatus tells the caller recovery is still pending.
      }
      return { ...result, deliveryStatus: 'enqueue_failed' };
    }
  };

  /** Worker-only automatic retry; keeps the target reserved across attempts. */
  retryWorker = (
    id: string,
    input: Parameters<DocumentRewriteRequestModel['retryWorker']>[1],
  ): Promise<DocumentRewriteTransitionResult | undefined> => this.model.retryWorker(id, input);

  promoteRetry = (id: string, attempt: number): Promise<DocumentRewriteRequestItem | undefined> =>
    this.model.promoteRetry(id, attempt);

  listRunnable = (limit?: number): Promise<DocumentRewriteRequestItem[]> =>
    this.model.listRunnable(limit);

  sweepPendingReviews = (options?: { maxAgeMs?: number; now?: Date }): Promise<number> =>
    this.model.sweepPendingReviews(options);

  /**
   * Mint the ephemeral room capability for a scoped request. The token itself
   * is never passed into the database model; workers should call this after a
   * successful claim and hand the result directly to the room provider.
   *
   * A ticket is bound to the live claim. A queued row, another worker's row,
   * or an expired lease cannot mint a room capability even if the caller knows
   * the request id.
   */
  issueRoomTicket = async (
    id: string,
    input: { attempt: number; roomId?: string; ttlMs?: number; workerId: string },
  ): Promise<string> => {
    const request = await this.model.assertCapacityForRequest(id, input.attempt);
    if (!request) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);
    if (isDocumentRewriteTerminal(request.status)) {
      throw new Error(`${DOCUMENT_REWRITE_ROOM_TICKET_INVALID}: terminal request`);
    }
    if (
      request.attempt !== input.attempt ||
      request.claimOwner !== input.workerId ||
      !request.leaseExpiresAt ||
      request.leaseExpiresAt.getTime() <= Date.now() ||
      (request.expiresAt != null && request.expiresAt.getTime() <= Date.now()) ||
      request.cancelRequestedAt != null ||
      request.status === 'cancel_requested' ||
      !DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES.includes(
        request.status as (typeof DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES)[number],
      )
    ) {
      throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_CLAIMED);
    }
    const leaseRemainingMs = request.leaseExpiresAt.getTime() - Date.now();
    if (leaseRemainingMs < 1_000) {
      throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_CLAIMED);
    }
    const roomId = input.roomId ?? request.selection.roomId;
    if (
      typeof roomId !== 'string' ||
      roomId.trim().length === 0 ||
      request.documentId !== roomId ||
      request.selection.roomId !== roomId
    ) {
      throw new Error(`${DOCUMENT_REWRITE_ROOM_TICKET_INVALID}: roomId`);
    }
    return issueDocumentRewriteRoomTicket({
      agentId: request.agentId,
      attempt: request.attempt,
      documentId: request.documentId,
      requestId: request.id,
      roomId,
      // Never issue a ticket that outlives the worker claim. The room verifier
      // may be remote, so this bound closes the lease-takeover window even
      // before a deployment-specific DB authorization callback is installed.
      ttlMs: Math.min(input.ttlMs ?? DOCUMENT_REWRITE_ROOM_TICKET_DEFAULT_TTL_MS, leaseRemainingMs),
      userId: this.userId,
      workerId: input.workerId,
      workspaceId: this.workspaceId,
    });
  };
}
