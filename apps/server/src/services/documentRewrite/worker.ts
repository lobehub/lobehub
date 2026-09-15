import type { PageContentContext } from '@lobechat/prompts';
import {
  type AgentAwarenessInput,
  type AgentAwarenessStatus,
  type BlockRewriteSelection,
  type CollaborativeAgentCommand,
  CollaborativeAgentEditor,
  type CollaborativeAgentEditorConnectOptions,
  deserializeRelativePosition,
  hashRewriteText,
  LITEXML_REWRITE_RANGE_COMMAND,
  normalizeRewriteText,
  type ResolvedRewriteSelection,
  type RewriteCommandResult,
  type RewriteSelection,
} from '@lobehub/editor/headless';
import * as EditorHeadless from '@lobehub/editor/headless';
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import type { BaseSelection } from 'lexical';
import { parseHTML } from 'linkedom';

import { DocumentModel } from '@/database/models/document';
import {
  DOCUMENT_REWRITE_DIRECT_APPLY_PROOF_INVALID,
  DOCUMENT_REWRITE_REQUEST_NOT_FOUND,
  type DocumentRewriteDirectApplyInput,
  DocumentRewriteRequestModel,
} from '@/database/models/documentRewriteRequest';
import { normalizeDocumentRewriteProgress } from '@/database/models/documentRewriteRequest';
import type {
  DocumentRewriteProgress,
  DocumentRewriteProgressStage,
  DocumentRewriteRequestItem,
  DocumentRewriteSelection,
} from '@/database/schemas/documentRewriteRequest';
import { documentRewriteRequests } from '@/database/schemas/documentRewriteRequest';
import type { LobeChatDatabase } from '@/database/type';

import {
  createDocumentRewriteQueueMessage,
  type DocumentRewriteQueue,
  type DocumentRewriteQueueMessage,
} from './queue';
import {
  DOCUMENT_REWRITE_ROOM_TICKET_BINDING_MISMATCH,
  DOCUMENT_REWRITE_ROOM_TICKET_INVALID,
  DOCUMENT_REWRITE_ROOM_TICKET_SECRET_MISSING,
} from './roomTicket';
import { DocumentRewriteRequestService, type EnsureDocumentRewriteTargetContext } from './service';
import { DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES } from './stateMachine';

/** A selection resolved by the editor facade, kept opaque to the generator. */
type RewriteResolvedSelection = ResolvedRewriteSelection;

/** Public progress emitted by the worker; never carry a reasoning delta here. */
export interface RewriteGeneratorProgress {
  detail?: string;
  stage: DocumentRewriteProgressStage;
  summary?: string;
  tool?: string;
}

/**
 * Bounded model-output telemetry. It deliberately contains no prompt,
 * document source, provider response, or credential material; the worker may
 * persist it as public progress when diagnosing a failed generation.
 */
export interface RewriteGeneratorDiagnostics {
  finishReason?: string;
  outputBytes: number;
  outputCharacters: number;
  /** Language parsed from a source-schema code fence, when available. */
  outputLanguage?: string;
  outputTextTokens?: number;
  requestedMaxTokens: number;
  streamError: boolean;
  totalOutputTokens?: number;
  usagePresent: boolean;
}

interface PersistedDocumentSnapshot {
  content: string | null;
  documentId: string;
  editorData: unknown;
  title: string | null;
}

export type RewriteGeneratorProgressHandler = (
  progress: RewriteGeneratorProgress,
) => Promise<void> | void;

/**
 * Sanitized model input. Keep editor/runtime objects and database rows on the
 * worker side of this boundary: in particular, never pass Lexical points,
 * RelativePositions, a Y.Doc, or the request's user/workspace columns to a
 * model adapter.
 */
export interface RewriteGeneratorInput {
  adapterId?: string;
  agentId: string;
  /** Existing topic message ids for live assistant persistence. */
  assistantMessageId?: string;
  attempt: number;
  /**
   * Server-verified image projection from the live block-image adapter. This
   * is ephemeral generator input; it is never persisted in the request row,
   * topic messages, progress, or Yjs.
   */
  blockImage?: CollaborativeAgentBlockRewriteImageTarget;
  documentId: string;
  endNodeId?: string;
  instruction: string;
  /** Canonical current language for source-backed code targets. */
  language?: string;
  model?: string;
  /** Adapter node type used to parse raw source completions. */
  nodeType?: string;
  /** Server-owned bounded telemetry sink; never includes model/document text. */
  onDiagnostics?: (diagnostics: RewriteGeneratorDiagnostics) => Promise<void> | void;
  /** Server-owned public progress sink; never serialized into the model prompt. */
  onProgress?: RewriteGeneratorProgressHandler;
  /** Editor-owned output contract for an adapter-owned node target. */
  outputSchema?: RewriteBlockOutputSchema;
  /** Canonical page context shape consumed by the shared MessagesEngine. */
  pageContentContext?: PageContentContext;
  provider?: string;
  quotedText: string;
  /** User-selected model snapshot; unlike model, it survives retry resets. */
  requestedModel?: string;
  /** User-selected provider snapshot; unlike provider, it survives retry resets. */
  requestedProvider?: string;
  requestId: string;
  /** Server-owned rewrite conversation identity. */
  sessionId?: string;
  signal: AbortSignal;
  sourceHash?: string;
  startNodeId?: string;
  targetKind?: 'node' | 'text-range';
  targetNodeId?: string;
  readonly targetNodeIds: readonly string[];
  /** Durable topic backing the rewrite session's ordinary chat messages. */
  topicId?: string | null;
  /** Monotonic turn within the server-owned session. */
  turnIndex?: number;
  userMessageId?: string;
}

export interface RewriteGeneratorOutput {
  generationId?: string;
  model?: string;
  provider?: string;
  replacementBlock?: RewriteBlockOutput;
  /** Exactly one of these values must be defined. Empty replacement text is valid. */
  replacementLiteXML?: string;
  replacementText?: string;
}

export interface RewriteBlockSourceOutput {
  kind: 'source';
  language?: string;
  source: string;
  title?: string;
}

export interface RewriteBlockPatchOutput {
  kind: 'patch';
  patch: Record<string, unknown>;
}

export type RewriteBlockOutputSchema = 'patch' | 'source';

export type RewriteBlockOutput = RewriteBlockPatchOutput | RewriteBlockSourceOutput;

type NormalizedRewriteOutput = Omit<
  RewriteGeneratorOutput,
  'replacementBlock' | 'replacementLiteXML' | 'replacementText'
> &
  (
    | { replacementBlock: RewriteBlockOutput; replacementLiteXML?: never; replacementText?: never }
    | { replacementBlock?: never; replacementLiteXML: string; replacementText?: never }
    | { replacementBlock?: never; replacementLiteXML?: never; replacementText: string }
  );

export interface CollaborativeAgentBlockRewriteTarget {
  adapterId: string;
  /** Editor-owned image projection for the `block-image` adapter. */
  image?: CollaborativeAgentBlockRewriteImageTarget;
  language?: string;
  languageAliases?: readonly string[];
  nodeId: string;
  nodeType: string;
  /** Editor-owned output contract; unknown values fail closed before generation. */
  outputSchema?: RewriteBlockOutputSchema;
  source?: string;
  sourceHash?: string;
  summary?: string;
  title?: string;
}

export interface CollaborativeAgentBlockRewriteImageTarget {
  altText: string;
  height: number | null;
  maxWidth: number | null;
  placeholder: boolean;
  src: string;
  status: 'uploaded' | 'loading' | 'error';
  width: number | null;
}

/**
 * One provider-emitted text fragment. `sequence`/`chunkId` are deliberately
 * transport metadata rather than document positions: an Editor streaming
 * session uses them to make redelivery idempotent without exposing a Lexical
 * node key or a raw Yjs type to the model adapter.
 */
export interface RewriteGeneratorChunk {
  chunkId?: string;
  sequence?: number;
  text: string;
}

export interface RewriteGeneratorStreamMetadata {
  generationId?: string;
  model?: string;
  provider?: string;
}

/**
 * The callable form keeps custom generators source-compatible with the
 * original `(input, onChunk)` shape. The optional `onStart` property lets a
 * production adapter publish model/provider metadata before the first token
 * arrives, so the durable writing transition and AI provenance use the same
 * identity as the provider request.
 */
export type RewriteGeneratorChunkHandler = ((
  chunk: RewriteGeneratorChunk | string,
) => Promise<void> | void) & {
  onStart?: (metadata: RewriteGeneratorStreamMetadata) => Promise<void> | void;
  onProgress?: RewriteGeneratorProgressHandler;
};

/**
 * Model boundary for targeted rewrite. Implementations may call the normal
 * Page Agent model runtime, but receive only request metadata, the current
 * resolved selection, and the durable topic/page context assembled by the
 * shared message engine; they never receive a Headless Editor, Y.Doc, or live
 * DB row and therefore cannot bypass the command gateway.
 */
export interface RewriteGenerator {
  generate?: (
    input: RewriteGeneratorInput,
  ) => Promise<RewriteGeneratorOutput> | RewriteGeneratorOutput;
  /**
   * Optional token stream. The promise resolves with final metadata and may
   * include replacement text for validation/fallback; the worker writes the
   * chunks through one bounded streaming session before it calls finalize.
   */
  generateStream?: (
    input: RewriteGeneratorInput,
    onChunk: RewriteGeneratorChunkHandler,
  ) => Promise<RewriteGeneratorOutput> | RewriteGeneratorOutput;
}

export type RewriteGeneratorLike = RewriteGenerator | NonNullable<RewriteGenerator['generate']>;

export interface RewriteGeneratorFactoryContext {
  agentId: string;
  requestedByUserId: string;
  workspaceId: string | null;
}

export type RewriteGeneratorFactory = (
  context: RewriteGeneratorFactoryContext,
) => RewriteGeneratorLike;

/** Small production adapter seam for a Page Agent model runtime. */
export interface PageAgentRewriteRuntime {
  generateRewrite: NonNullable<RewriteGenerator['generate']>;
  generateRewriteStream?: NonNullable<RewriteGenerator['generateStream']>;
}

export const createPageAgentRewriteGenerator = (
  runtime: PageAgentRewriteRuntime,
): RewriteGenerator => ({
  generate: (input) => runtime.generateRewrite(input),
  ...(runtime.generateRewriteStream
    ? { generateStream: (input, onChunk) => runtime.generateRewriteStream!(input, onChunk) }
    : {}),
});

/** Payload used to open a direct, incremental rewrite in the shared room. */
export interface CollaborativeAgentStreamingRewriteInput {
  expectedTextHash: string;
  generationId: string;
  model?: string | null;
  /** Page rewrite conversation identity for persistent AI provenance. */
  provenanceSessionId?: string;
  provider?: string | null;
  requestId: string;
  selection: DocumentRewriteSelection;
  /** Stable session identity used by the Editor's append/finalize wire calls. */
  sessionId: string;
  turnIndex?: number;
}

/** One coalesced batch sent to the Editor's streaming command session. */
export interface CollaborativeAgentStreamingRewriteChunk {
  chunkId: string;
  /** IDs of the source provider chunks included in this batch. */
  chunkIds?: readonly string[];
  sequence?: number;
  text: string;
}

/**
 * Restricted Editor session for a direct stream. The Editor owns selection
 * resolution, target-conflict detection and Yjs transactions. `finalize`
 * accepts an optional final text only to let the command trim provider
 * framing whitespace; a session may ignore that argument when it has already
 * retained the canonical text internally.
 */
export interface CollaborativeAgentStreamingRewriteSession {
  abort?: () => Promise<void> | void;
  append: (
    chunk: CollaborativeAgentStreamingRewriteChunk,
  ) => Promise<RewriteCommandResult | void> | RewriteCommandResult | void;
  commandId?: string;
  finalize: (input?: {
    attempt?: number;
    generationId?: string;
    model?: string | null;
    provider?: string | null;
    replacementLiteXML?: string;
    replacementText?: string;
    requestId?: string;
  }) => Promise<RewriteCommandResult | void> | RewriteCommandResult | void;
}

/** Result returned by the source-linked Editor's method-based stream API. */
export interface CollaborativeAgentStreamingRewriteResult {
  affectedNodeIds?: string[];
  commandId?: string;
  error?: string;
  generationId?: string;
  requestId?: string;
  sequence?: number;
  sessionId?: string;
  stateVector?: string;
  status?: string;
}

/** Read-only durable target presence proof exposed by newer Editor builds. */
export interface CollaborativeAgentRewriteTargetInspection {
  existingNodeIds: string[];
  missingNodeIds: string[];
}

/**
 * Optional capability added by the Editor package. Keeping this method
 * optional lets older source-linked Page bundles keep their one-shot direct
 * path while the new bundle animates provider chunks in the same Yjs room.
 */
export type CollaborativeAgentStreamingRewriteStart = (
  input: CollaborativeAgentStreamingRewriteInput,
) =>
  | CollaborativeAgentStreamingRewriteResult
  | CollaborativeAgentStreamingRewriteSession
  | Promise<CollaborativeAgentStreamingRewriteResult | CollaborativeAgentStreamingRewriteSession>;

export interface CollaborativeAgentEditorSession {
  abortStreamingRewrite?: unknown;
  appendStreamingRewrite?: unknown;
  cleanupRewriteSession?: unknown;
  cleanupStreamingRewrite?: unknown;
  clearAwareness?: () => void;
  connect?: () => Promise<unknown> | unknown;
  disconnect: () => Promise<unknown> | unknown;
  dispatchCommand: (
    command: CollaborativeAgentCommand,
    payload: unknown,
  ) => Promise<RewriteCommandResult> | RewriteCommandResult;
  finalizeStreamingRewrite?: unknown;
  getRewriteResult?: (requestId?: string) => RewriteCommandResult | undefined;
  /** State vector observed after the direct command has entered the room. */
  getStateVector?: () => string;
  inspectRewriteTargets?: unknown;
  recoverRewriteSession?: unknown;
  resolveBlockRewriteTarget?: (input: {
    adapterId: string;
    nodeId: string;
    sourceHash?: string;
  }) => CollaborativeAgentBlockRewriteTarget | null;
  resolveSelection: (selection: RewriteSelection) => RewriteResolvedSelection | null;
  /** Re-locate a text range after a Markdown rewrite changed its block shape. */
  resolveSelectionByProvenance?: (
    sessionId: string,
    expectedTextHash?: string,
    targetNodeIds?: ReadonlyArray<string>,
  ) => RewriteResolvedSelection | null;
  setAgentAwareness?: (input: AgentAwarenessInput) => void;
  setAgentStatus?: (status: AgentAwarenessStatus) => void;
  setSelection?: (selection: BaseSelection) => boolean;
  /** Transitional aliases accepted while source-linked Editor builds roll out. */
  startRewriteStream?: unknown;
  /** Start an incremental direct rewrite in this synced room. */
  startStreamingRewrite?: unknown;
  startStreamingSession?: unknown;
  waitForSync: () => Promise<void> | void;
  /** Wait until local Yjs updates have been acknowledged by the room. */
  waitForUpdateAck?: (timeoutMs?: number) => Promise<void>;
}

export interface CollaborativeAgentEditorFactory {
  connect?: (
    options: CollaborativeAgentEditorConnectOptions,
  ) => Promise<CollaborativeAgentEditorSession> | CollaborativeAgentEditorSession;
  /**
   * Optional pre-connect seam. It lets the worker publish `connecting`
   * awareness before an auth/sync promise settles; custom factories may keep
   * `connect` for already-connected or test sessions.
   */
  create?: (
    options: CollaborativeAgentEditorConnectOptions,
  ) => Promise<CollaborativeAgentEditorSession> | CollaborativeAgentEditorSession;
}

type RefreshableProviderOptions = NonNullable<
  CollaborativeAgentEditorConnectOptions['providerOptions']
> & {
  refreshTicket?: () => Promise<string> | string;
};

export const DOCUMENT_REWRITE_COLLABORATION_WS_URL_ENV = 'PAGE_COLLABORATION_WS_URL';

/**
 * Resolve the room endpoint at the worker boundary. Production must inject an
 * explicit endpoint; silently falling back to localhost would strand workers
 * when the relay is a separate service or listens on a non-default port.
 */
export const resolveDocumentRewriteCollaborationWsUrl = (explicit?: string): string => {
  const configured =
    explicit?.trim() ||
    process.env[DOCUMENT_REWRITE_COLLABORATION_WS_URL_ENV]?.trim() ||
    process.env.NEXT_PUBLIC_PAGE_COLLABORATION_URL?.trim();
  if (configured) {
    const normalized = configured.replace(/\/+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      throw new Error(`${DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED}: invalid WebSocket URL`);
    }
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      throw new Error(`${DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED}: WebSocket URL must use ws/wss`);
    }
    return normalized;
  }
  if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
    throw new Error(
      `${DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED}: ${DOCUMENT_REWRITE_COLLABORATION_WS_URL_ENV} is required outside development/test`,
    );
  }

  const host = process.env.PAGE_COLLABORATION_HOST?.trim() || '127.0.0.1';
  const port = process.env.PAGE_COLLABORATION_PORT?.trim() || '12345';
  return `ws://${host}:${port}`;
};

const defaultEditorFactory: CollaborativeAgentEditorFactory = {
  // The headless facade constructs the private Doc/provider itself. `create`
  // intentionally returns only the restricted session so the worker can set
  // awareness before it starts auth/sync.
  create: (options) => CollaborativeAgentEditor.create(options),
};

/** Exported for composition/tests; no raw Yjs or kernel object is exposed. */
export const documentRewriteEditorFactory: CollaborativeAgentEditorFactory = defaultEditorFactory;

export interface DocumentRewriteRequestLifecycle {
  claim: (
    id: string,
    input: { attempt: number; leaseMs?: number; workerId: string },
  ) => Promise<DocumentRewriteRequestItem | undefined>;
  ensureTopicTurn?: (input: {
    agentId: string;
    attempt: number;
    documentId?: string;
    instruction: string;
    model?: string | null;
    provider?: string | null;
    requestId: string;
    operationId?: string | null;
    sessionId?: string | null;
    status?: DocumentRewriteRequestItem['status'];
    targetContext?: EnsureDocumentRewriteTargetContext;
    topicId?: string | null;
  }) => Promise<
    | {
        assistantMessageId: string;
        topicId: string;
        userMessageId: string;
      }
    | undefined
  >;
  findById: (id: string) => Promise<DocumentRewriteRequestItem | undefined>;
  issueRoomTicket: (
    id: string,
    input: { attempt: number; roomId?: string; ttlMs?: number; workerId: string },
  ) => Promise<string>;
  listRunnable?: (limit?: number) => Promise<DocumentRewriteRequestItem[]>;
  /** Settle a direct command after the room persistence proof is durable. */
  markDirectApplied?: (
    id: string,
    input: DocumentRewriteDirectApplyInput,
  ) => Promise<{ isDuplicate: boolean; request: DocumentRewriteRequestItem } | undefined>;
  promoteRetry?: (id: string, attempt: number) => Promise<DocumentRewriteRequestItem | undefined>;
  renewLease: (
    id: string,
    input: { attempt: number; leaseMs?: number; workerId: string },
  ) => Promise<DocumentRewriteRequestItem | undefined>;
  retryWorker?: (
    id: string,
    input: {
      attempt: number;
      delayMs?: number;
      errorCode?: string | null;
      errorMessage?: string | null;
      workerId: string;
    },
  ) => Promise<{ isDuplicate: boolean; request: DocumentRewriteRequestItem } | undefined>;
  sweepPendingReviews?: (options?: { maxAgeMs?: number; now?: Date }) => Promise<number>;
  transitionWorker: (
    id: string,
    input: {
      attempt: number;
      errorCode?: string | null;
      errorMessage?: string | null;
      generationId?: string | null;
      lastCommandId?: string | null;
      model?: string | null;
      nextAttemptAt?: Date | null;
      outputText?: string | null;
      provider?: string | null;
      status: DocumentRewriteRequestItem['status'];
      workerId: string;
    },
  ) => Promise<{ isDuplicate: boolean; request: DocumentRewriteRequestItem } | undefined>;
  /** Persist bounded public progress without changing the request status. */
  updateProgress?: (
    id: string,
    input: {
      attempt: number;
      progress: DocumentRewriteProgress | null;
      workerId: string;
    },
  ) => Promise<DocumentRewriteRequestItem | undefined>;
}

export interface DocumentRewriteWorkerOptions {
  /** Legacy review setting retained for old queued rows; new requests never use it. */
  awaitingReviewAwarenessTtlMs?: number;
  /** Legacy review setting retained for old queued rows; new requests never use it. */
  awaitingReviewPollMs?: number;
  /** Source-linked editor command identity for adapter-owned block rewrites. */
  blockRewriteCommand?: CollaborativeAgentCommand;
  /** Polling is only used to abort a model call after durable cancellation. */
  cancellationPollMs?: number;
  /** Explicit room endpoint; required in production. */
  collaborationWsUrl?: string;
  /** Upper bound for editor-factory/provider connection setup. */
  connectTimeoutMs?: number;
  db?: LobeChatDatabase;
  /** Poll interval while waiting for the direct room persistence proof. */
  directPersistencePollMs?: number;
  /** Upper bound for waiting for the room persistence worker after a direct write. */
  directPersistenceTimeoutMs?: number;
  editorFactory?: CollaborativeAgentEditorFactory;
  generator?: RewriteGeneratorLike;
  generatorFactory?: RewriteGeneratorFactory;
  leaseMs?: number;
  logger?: Pick<Console, 'error' | 'info' | 'warn'>;
  maxAttempts?: number;
  queue?: DocumentRewriteQueue;
  requestService?: DocumentRewriteRequestLifecycle;
  requestServiceFactory?: (request: DocumentRewriteRequestItem) => DocumentRewriteRequestLifecycle;
  retryBackoffMs?: (attempt: number, error: unknown) => number;
  /**
   * Flush provider chunks to the Editor in this bounded interval. Values are
   * clamped to 30–80ms so a provider cannot accidentally turn the room into a
   * per-character update firehose or make the cursor appear frozen.
   */
  streamingFlushMs?: number;
  /** Number of graphemes in one paced append (production-safe 1–4). */
  streamingGraphemeBatchSize?: number;
  /** Base delay between complete grapheme appends (production-safe 35–60ms). */
  streamingGraphemePacingMs?: number;
  /** Upper bound for the initial room sync barrier. */
  syncTimeoutMs?: number;
  workerId?: string;
}

export interface DocumentRewriteWorkerResult {
  attempt: number;
  commandId?: string;
  reason?: string;
  requestId: string;
  status: DocumentRewriteRequestItem['status'] | 'deferred' | 'ignored' | 'retry_wait';
}

export type DocumentRewriteWorkerFactory = (input: {
  db: LobeChatDatabase;
}) => DocumentRewriteWorker | Promise<DocumentRewriteWorker>;

export const DOCUMENT_REWRITE_WORKER_DEFAULT_LEASE_MS = 60_000;
export const DOCUMENT_REWRITE_DEFAULT_MAX_ATTEMPTS = 3;
export const DOCUMENT_REWRITE_DEFAULT_RETRY_BACKOFF_MS = 1_000;
export const DOCUMENT_REWRITE_MAX_GENERATED_OUTPUT_BYTES = 1_048_576;
export const DOCUMENT_REWRITE_MAX_ERROR_MESSAGE_LENGTH = 16_384;
export const DOCUMENT_REWRITE_DEFAULT_CANCELLATION_POLL_MS = 250;
export const DOCUMENT_REWRITE_DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
export const DOCUMENT_REWRITE_DEFAULT_SYNC_TIMEOUT_MS = 30_000;
export const DOCUMENT_REWRITE_DEFAULT_AWAITING_REVIEW_POLL_MS = 1_000;
export const DOCUMENT_REWRITE_DEFAULT_AWAITING_REVIEW_AWARENESS_TTL_MS = 10 * 60_000;
export const DOCUMENT_REWRITE_DEFAULT_DIRECT_PERSISTENCE_POLL_MS = 100;
export const DOCUMENT_REWRITE_DEFAULT_DIRECT_PERSISTENCE_TIMEOUT_MS = 30_000;
export const DOCUMENT_REWRITE_DEFAULT_STREAMING_FLUSH_MS = 50;
export const DOCUMENT_REWRITE_MIN_STREAMING_FLUSH_MS = 30;
export const DOCUMENT_REWRITE_MAX_STREAMING_FLUSH_MS = 80;
export const DOCUMENT_REWRITE_DEFAULT_GRAPHEME_PACING_MS = 45;
export const DOCUMENT_REWRITE_MIN_GRAPHEME_PACING_MS = 35;
export const DOCUMENT_REWRITE_MAX_GRAPHEME_PACING_MS = 60;
export const DOCUMENT_REWRITE_GRAPHEME_PACING_MS_ENV = 'DOCUMENT_REWRITE_GRAPHEME_PACING_MS';
export const DOCUMENT_REWRITE_DEFAULT_GRAPHEME_BATCH_SIZE = 2;
export const DOCUMENT_REWRITE_MIN_GRAPHEME_BATCH_SIZE = 1;
export const DOCUMENT_REWRITE_MAX_GRAPHEME_BATCH_SIZE = 4;
export const DOCUMENT_REWRITE_GRAPHEME_BATCH_SIZE_ENV = 'DOCUMENT_REWRITE_GRAPHEME_BATCH_SIZE';

export const DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED = 'DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED';
export const DOCUMENT_REWRITE_WORKER_TOPIC_REQUIRED = 'DOCUMENT_REWRITE_WORKER_TOPIC_REQUIRED';
export const DOCUMENT_REWRITE_WORKER_STALE = 'DOCUMENT_REWRITE_WORKER_STALE';
export const DOCUMENT_REWRITE_WORKER_CANCELED = 'DOCUMENT_REWRITE_WORKER_CANCELED';
export const DOCUMENT_REWRITE_WORKER_LEASE_LOST = 'DOCUMENT_REWRITE_WORKER_LEASE_LOST';
export const DOCUMENT_REWRITE_WORKER_GENERATOR_INVALID =
  'DOCUMENT_REWRITE_WORKER_GENERATOR_INVALID';
export const DOCUMENT_REWRITE_WORKER_COMMAND_FAILED = 'DOCUMENT_REWRITE_WORKER_COMMAND_FAILED';
export const DOCUMENT_REWRITE_WORKER_SYNC_TIMEOUT = 'DOCUMENT_REWRITE_WORKER_SYNC_TIMEOUT';
export const DOCUMENT_REWRITE_WORKER_DIRECT_PERSISTENCE_TIMEOUT =
  'DOCUMENT_REWRITE_WORKER_DIRECT_PERSISTENCE_TIMEOUT';
export const DOCUMENT_REWRITE_WORKER_REGION_MISSING = 'DOCUMENT_REWRITE_WORKER_REGION_MISSING';
export const DOCUMENT_REWRITE_WORKER_GENERATION_CONFLICT =
  'DOCUMENT_REWRITE_WORKER_GENERATION_CONFLICT';
export const DOCUMENT_REWRITE_WORKER_STREAM_STOPPED = 'DOCUMENT_REWRITE_WORKER_STREAM_STOPPED';
export const DOCUMENT_REWRITE_WORKER_STREAM_SESSION_BUSY =
  'DOCUMENT_REWRITE_WORKER_STREAM_SESSION_BUSY';

const normalizeRecoveryLimit = (limit: number): number =>
  Number.isFinite(limit) && Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 50;

export class DocumentRewriteWorkerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'DocumentRewriteWorkerError';
  }
}

const getApplyBlockRewriteCommand = (
  override?: CollaborativeAgentCommand,
): CollaborativeAgentCommand => {
  const command =
    override ??
    (
      EditorHeadless as unknown as {
        APPLY_BLOCK_REWRITE_COMMAND?: unknown;
      }
    ).APPLY_BLOCK_REWRITE_COMMAND;
  if (!command) {
    throw new DocumentRewriteWorkerError(
      'Collaborative Agent editor does not support block rewrites',
      DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED,
      false,
    );
  }
  return command as CollaborativeAgentCommand;
};

export class DocumentRewriteStaleError extends DocumentRewriteWorkerError {
  constructor(message = 'Rewrite selection is stale') {
    super(message, DOCUMENT_REWRITE_WORKER_STALE, false);
  }
}

export class DocumentRewriteCanceledError extends DocumentRewriteWorkerError {
  constructor(message = 'Rewrite request was canceled') {
    super(message, DOCUMENT_REWRITE_WORKER_CANCELED, false);
  }
}

export class DocumentRewriteLeaseLostError extends DocumentRewriteWorkerError {
  constructor(message = 'Rewrite worker lease is no longer valid') {
    super(message, DOCUMENT_REWRITE_WORKER_LEASE_LOST, true);
  }
}

export class DocumentRewriteGeneratorInvalidError extends DocumentRewriteWorkerError {
  constructor(message: string) {
    super(message, DOCUMENT_REWRITE_WORKER_GENERATOR_INVALID, false);
  }
}

/**
 * The provider produced an incomplete adapter source before any room write.
 * It remains fail-closed, but a fresh model attempt is safe because the
 * existing document was never touched. Keep the public error code aligned
 * with the generic generator-invalid contract for API compatibility.
 */
export class DocumentRewriteArtifactIncompleteError extends DocumentRewriteWorkerError {
  constructor(
    message: string,
    readonly diagnostics?: RewriteGeneratorDiagnostics,
  ) {
    super(message, DOCUMENT_REWRITE_WORKER_GENERATOR_INVALID, true);
  }
}

export class DocumentRewriteCommandFailedError extends DocumentRewriteWorkerError {
  constructor(message: string) {
    super(message, DOCUMENT_REWRITE_WORKER_COMMAND_FAILED, false);
  }
}

export class DocumentRewriteSyncTimeoutError extends DocumentRewriteWorkerError {
  constructor(message = 'Collaboration initial sync timed out') {
    super(message, DOCUMENT_REWRITE_WORKER_SYNC_TIMEOUT, true);
  }
}

export class DocumentRewritePersistenceTimeoutError extends DocumentRewriteWorkerError {
  constructor(message = 'Direct rewrite room persistence did not become durable in time') {
    super(message, DOCUMENT_REWRITE_WORKER_DIRECT_PERSISTENCE_TIMEOUT, true);
  }
}

/** The user removed the protected target region while an Agent was writing. */
export class DocumentRewriteRegionMissingError extends DocumentRewriteWorkerError {
  constructor(message = 'Rewrite target region is no longer present') {
    super(message, DOCUMENT_REWRITE_WORKER_REGION_MISSING, false);
  }
}

/** The protected generation region changed under the Agent stream. */
export class DocumentRewriteGenerationConflictError extends DocumentRewriteWorkerError {
  constructor(message = 'Rewrite target changed while the Agent was writing') {
    super(message, DOCUMENT_REWRITE_WORKER_GENERATION_CONFLICT, false);
  }
}

/** A stream stopped for a transient transport reason before a target conflict. */
export class DocumentRewriteStreamingTransportError extends DocumentRewriteWorkerError {
  constructor(message = 'Rewrite streaming transport stopped') {
    super(message, DOCUMENT_REWRITE_WORKER_STREAM_STOPPED, true);
  }
}

/** The Editor already has an active stream for this block; retry before write. */
export class DocumentRewriteStreamingSessionBusyError extends DocumentRewriteWorkerError {
  constructor(message = 'Rewrite streaming session is already active') {
    super(message, DOCUMENT_REWRITE_WORKER_STREAM_SESSION_BUSY, true);
  }
}

const waitForSyncWithAbort = async (
  editor: CollaborativeAgentEditorSession,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> => {
  if (signal.aborted) throw new DocumentRewriteCanceledError();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finishReject(new DocumentRewriteSyncTimeoutError());
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const finishResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => finishReject(new DocumentRewriteCanceledError());

    signal.addEventListener('abort', onAbort, { once: true });
    try {
      Promise.resolve(editor.waitForSync()).then(finishResolve, finishReject);
    } catch (error) {
      finishReject(error);
    }
  });
};

/**
 * Bound every phase that can await an Agent room connection. A provider's
 * `connect()` often returns before auth/sync, but custom factories may keep
 * the promise pending for the whole lifecycle. The worker must still return
 * through its retry/failure path so the durable request lease is released.
 * Late factory results are disconnected as soon as they arrive, preventing a
 * timed-out attempt from leaving a socket alive in the background.
 */
const awaitWithAbortAndTimeout = async <T>(
  operation: () => T | PromiseLike<T>,
  signal: AbortSignal,
  timeoutMs: number,
  timeoutError: Error,
  onTimeout?: () => void,
  onLateSuccess?: (value: T) => void,
): Promise<T> => {
  if (signal.aborted) throw new DocumentRewriteCanceledError();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const finishResolve = (value: T): void => {
      if (settled) {
        try {
          onLateSuccess?.(value);
        } catch {
          // A late factory result is already outside the request lifecycle;
          // cleanup failures must not become unhandled timer/promise errors.
        }
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };
    const finishReject = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = (): void => finishReject(new DocumentRewriteCanceledError());
    const timer = setTimeout(() => {
      if (settled) return;
      try {
        onTimeout?.();
      } catch {
        // Continue to the bounded rejection even when best-effort cleanup
        // itself fails.
      }
      finishReject(timeoutError);
    }, timeoutMs);

    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(operation).then(finishResolve, finishReject);
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The editor package may add direct command statuses independently of Page. */
const commandStatus = (result: RewriteCommandResult | undefined): string | undefined => {
  if (!result) return undefined;
  const status = (result as unknown as { status?: unknown }).status;
  return typeof status === 'string' ? status : undefined;
};

const asMessage = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.slice(0, DOCUMENT_REWRITE_MAX_ERROR_MESSAGE_LENGTH);
};

const formatRewriteOutputLanguage = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0
    ? value
        .trim()
        .replaceAll(/[^\w+#.-]/giu, '_')
        .slice(0, 64)
    : undefined;

/** Keep model truncation diagnostics bounded and free of prompt/source text. */
const formatRewriteGeneratorDiagnostics = (
  diagnostics: RewriteGeneratorDiagnostics,
  options: { includeOutputLanguage?: boolean } = {},
): string => {
  const finishReason =
    typeof diagnostics.finishReason === 'string' && diagnostics.finishReason.trim().length > 0
      ? diagnostics.finishReason.replaceAll(/[^\w-]/giu, '_').slice(0, 32)
      : 'unknown';
  const boundedCount = (value: unknown): number | 'unknown' =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 'unknown';
  const outputCharacters = boundedCount(diagnostics.outputCharacters);
  const outputBytes = boundedCount(diagnostics.outputBytes);
  const outputTextTokens = boundedCount(diagnostics.outputTextTokens);
  const totalOutputTokens = boundedCount(diagnostics.totalOutputTokens);
  const requestedMaxTokens = boundedCount(diagnostics.requestedMaxTokens);
  const outputLanguage =
    options.includeOutputLanguage !== false
      ? formatRewriteOutputLanguage(diagnostics.outputLanguage)
      : undefined;
  return [
    `finish_reason=${finishReason}`,
    ...(outputLanguage ? [`output_language=${outputLanguage}`] : []),
    `output_chars=${outputCharacters}`,
    `output_bytes=${outputBytes}`,
    `output_tokens=${outputTextTokens}`,
    `total_tokens=${totalOutputTokens}`,
    `max_tokens=${requestedMaxTokens}`,
    `stream_error=${diagnostics.streamError ? 'yes' : 'no'}`,
    `usage_present=${diagnostics.usagePresent ? 'yes' : 'no'}`,
  ].join(' ');
};

const asDurableErrorMessage = (error: unknown, previous?: string | null): string => {
  const base = asMessage(error);
  const diagnostics =
    isRecord(error) && isRecord(error.diagnostics) ? error.diagnostics : undefined;
  const diagnosticText = diagnostics
    ? formatRewriteGeneratorDiagnostics({
        finishReason:
          typeof diagnostics.finishReason === 'string' ? diagnostics.finishReason : undefined,
        ...(typeof diagnostics.outputLanguage === 'string'
          ? { outputLanguage: diagnostics.outputLanguage }
          : {}),
        outputBytes: diagnostics.outputBytes as number,
        outputCharacters: diagnostics.outputCharacters as number,
        ...(typeof diagnostics.outputTextTokens === 'number'
          ? { outputTextTokens: diagnostics.outputTextTokens }
          : {}),
        requestedMaxTokens: diagnostics.requestedMaxTokens as number,
        streamError: diagnostics.streamError === true,
        ...(typeof diagnostics.totalOutputTokens === 'number'
          ? { totalOutputTokens: diagnostics.totalOutputTokens }
          : {}),
        usagePresent: diagnostics.usagePresent === true,
      })
    : undefined;
  const current =
    diagnosticText && !base.includes('finish_reason=') ? `${base}; ${diagnosticText}` : base;
  const prior = previous?.trim();
  if (!prior || prior === current || current.includes(prior)) {
    return current.slice(0, DOCUMENT_REWRITE_MAX_ERROR_MESSAGE_LENGTH);
  }
  return `${prior} | ${current}`.slice(0, DOCUMENT_REWRITE_MAX_ERROR_MESSAGE_LENGTH);
};

const errorCode = (error: unknown): string => {
  if (isRecord(error) && typeof error.code === 'string' && error.code.trim()) {
    return error.code.trim().slice(0, 128);
  }
  if (error instanceof DocumentRewriteWorkerError) return error.code;
  if (error instanceof Error && error.name.trim()) return error.name.slice(0, 128);
  return 'WORKER_ERROR';
};

/**
 * Provider/model diagnostics are allowed only as bounded identifiers attached
 * by the production generator. Never copy arbitrary provider error payloads
 * into durable request columns: those payloads may contain request excerpts
 * or credentials. The generator's config error carries only these two fields.
 */
const errorDiagnosticValue = (error: unknown, key: 'model' | 'provider'): string | undefined => {
  if (!isRecord(error) || typeof error[key] !== 'string') return undefined;
  const value = error[key].trim();
  return value.length > 0 ? value.slice(0, 255) : undefined;
};

const outputBytes = (value: string): number => {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return Buffer.byteLength(value, 'utf8');
};

const isTerminalStatus = (status: DocumentRewriteRequestItem['status']): boolean =>
  ['applied', 'rejected', 'canceled', 'canceled_after_write', 'stale', 'failed'].includes(status);

const isCancellationStatus = (status: DocumentRewriteRequestItem['status']): boolean =>
  status === 'cancel_requested' || status === 'canceled';

const isRetryableError = (error: unknown): boolean => {
  if (error instanceof DocumentRewriteWorkerError) return error.retryable;
  if (isRecord(error)) {
    if (typeof error.retryable === 'boolean') return error.retryable;
    if (
      error.code === DOCUMENT_REWRITE_ROOM_TICKET_SECRET_MISSING ||
      error.code === DOCUMENT_REWRITE_ROOM_TICKET_INVALID ||
      error.code === DOCUMENT_REWRITE_ROOM_TICKET_BINDING_MISMATCH
    ) {
      return false;
    }
  }
  return true;
};

const isStreamSessionBusyError = (value: unknown): boolean => {
  const raw =
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : isRecord(value)
          ? [value.code, value.status, value.error, value.message]
              .filter((part): part is string => typeof part === 'string')
              .join(' ')
          : '';
  return /stream[-_ ]session[-_ ]busy/i.test(raw);
};

const isRewriteBlockOutput = (value: unknown): value is RewriteBlockOutput => {
  if (!isRecord(value) || Array.isArray(value)) return false;
  if (value.kind === 'source') {
    return (
      typeof value.source === 'string' &&
      outputBytes(value.source) <= DOCUMENT_REWRITE_MAX_GENERATED_OUTPUT_BYTES &&
      (value.language === undefined ||
        (typeof value.language === 'string' &&
          value.language.trim().length > 0 &&
          value.language.length <= 64)) &&
      (value.title === undefined ||
        (typeof value.title === 'string' &&
          value.title.trim().length > 0 &&
          value.title.length <= 255))
    );
  }
  if (value.kind !== 'patch' || !isRecord(value.patch) || Array.isArray(value.patch)) return false;
  try {
    return outputBytes(JSON.stringify(value.patch)) <= DOCUMENT_REWRITE_MAX_GENERATED_OUTPUT_BYTES;
  } catch {
    return false;
  }
};

const isRewriteBlockOutputSchema = (value: unknown): value is RewriteBlockOutputSchema =>
  value === 'source' || value === 'patch';

const normalizeArtifactTitle = (value: string): string => value.replaceAll(/\s+/gu, ' ').trim();

const extractArtifactTitle = (html: string): string | undefined => {
  const { document } = parseHTML(html);
  const title = normalizeArtifactTitle(document.querySelector('title')?.textContent || '');
  return title || undefined;
};

const serializeRewriteBlockOutput = (output: RewriteBlockOutput): string =>
  output.kind === 'source' ? output.source : JSON.stringify(output.patch);

/**
 * Prove that the adapter-owned source in the room is the result the Agent
 * generated before the request can become applied. A command result only
 * proves that a listener accepted the payload; the adapter projection is the
 * source of truth for the document users actually see and persist.
 *
 * Patch adapters do not expose a generic expected source (their patch shape
 * is adapter-specific), but they must still return a materialized source with
 * a self-consistent hash. The link-card adapter is the current patch adapter;
 * source adapters can be checked against the exact generated source.
 */
const assertAppliedAdapterNodeSource = (
  target: CollaborativeAgentBlockRewriteTarget | null | undefined,
  output?: RewriteBlockOutput,
  expectedLanguage?: string,
  expectedTitle?: string,
): string => {
  if (!isRewriteBlockOutputSchema(target?.outputSchema)) {
    throw new DocumentRewriteGenerationConflictError(
      'Rewrite node output schema is unavailable after the command',
    );
  }
  if (!target || typeof target.source !== 'string' || typeof target.sourceHash !== 'string') {
    throw new DocumentRewriteGenerationConflictError(
      'Rewrite node source is unavailable after the command',
    );
  }

  const actualSource = normalizeRewriteText(target.source);
  const actualHash = hashRewriteText(target.source);
  if (target.sourceHash !== actualHash) {
    throw new DocumentRewriteGenerationConflictError(
      'Rewrite node source hash is invalid after the command',
    );
  }

  if (output?.kind === 'source') {
    if (target.outputSchema !== output.kind) {
      throw new DocumentRewriteGenerationConflictError(
        'Rewrite node output kind differs from the adapter schema',
      );
    }
    const expectedSource = normalizeRewriteText(output.source);
    const expectedHash = hashRewriteText(output.source);
    if (actualSource !== expectedSource || actualHash !== expectedHash) {
      throw new DocumentRewriteGenerationConflictError(
        'Rewrite node source differs from the generated source',
      );
    }
    if (output.language !== undefined) {
      const expectedLanguage = output.language.trim().toLocaleLowerCase();
      const acceptedLanguages = [target.language, ...(target.languageAliases ?? [])]
        .filter((language): language is string => typeof language === 'string')
        .map((language) => language.trim().toLocaleLowerCase());
      if (!expectedLanguage || !acceptedLanguages.includes(expectedLanguage)) {
        throw new DocumentRewriteGenerationConflictError(
          'Rewrite node language differs from the generated language',
        );
      }
    } else if (
      expectedLanguage !== undefined &&
      target.language?.trim().toLocaleLowerCase() !== expectedLanguage.trim().toLocaleLowerCase()
    ) {
      throw new DocumentRewriteGenerationConflictError(
        'Rewrite node language changed without a generated language',
      );
    }
  }

  if (output?.kind === 'patch' && target.outputSchema !== output.kind) {
    throw new DocumentRewriteGenerationConflictError(
      'Rewrite node output kind differs from the adapter schema',
    );
  }

  if (target.adapterId === 'block-image' && output?.kind === 'patch') {
    const patch = output.patch;
    const allowedKeys = new Set(['altText', 'height', 'maxWidth', 'src', 'width']);
    if (Object.keys(patch).some((key) => !allowedKeys.has(key))) {
      throw new DocumentRewriteGenerationConflictError(
        'Block image adapter materialized an unsupported patch field',
      );
    }
    if (
      typeof patch.src !== 'string' ||
      (!patch.src.startsWith('/') && !/^https?:\/\//iu.test(patch.src)) ||
      patch.src.startsWith('//') ||
      /^data:|^blob:/iu.test(patch.src)
    ) {
      throw new DocumentRewriteGenerationConflictError(
        'Block image adapter materialized an invalid image source',
      );
    }
    if (
      !target.image ||
      target.image.src !== patch.src ||
      target.image.status !== 'uploaded' ||
      target.image.placeholder
    ) {
      throw new DocumentRewriteGenerationConflictError(
        'Block image adapter did not materialize the generated image state',
      );
    }
    for (const key of ['width', 'height', 'maxWidth'] as const) {
      const value = patch[key];
      if (
        value !== undefined &&
        (typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < 0 ||
          target.image[key] !== value)
      ) {
        throw new DocumentRewriteGenerationConflictError(
          `Block image adapter did not materialize ${key}`,
        );
      }
    }
    if (patch.altText !== undefined && target.image.altText !== patch.altText) {
      throw new DocumentRewriteGenerationConflictError(
        'Block image adapter did not materialize altText',
      );
    }
  }

  if (target.nodeType === 'artifact') {
    const expectedArtifactTitle =
      output?.kind === 'source'
        ? output.title === undefined
          ? (extractArtifactTitle(output.source) ?? expectedTitle)
          : normalizeArtifactTitle(output.title)
        : (extractArtifactTitle(target.source) ?? expectedTitle);
    if (expectedArtifactTitle && target.title !== expectedArtifactTitle) {
      throw new DocumentRewriteGenerationConflictError(
        'Rewrite node title differs from the generated Artifact title',
      );
    }
  }

  return target.source;
};

const normalizeOutput = (output: unknown): NormalizedRewriteOutput => {
  if (!isRecord(output)) {
    throw new DocumentRewriteGeneratorInvalidError(
      'Rewrite generator returned a non-object result',
    );
  }
  const hasText = typeof output.replacementText === 'string';
  const hasLiteXML = typeof output.replacementLiteXML === 'string';
  const hasBlock = isRewriteBlockOutput(output.replacementBlock);
  if (
    (output.replacementBlock !== undefined && !hasBlock) ||
    Number(hasText) + Number(hasLiteXML) + Number(hasBlock) !== 1
  ) {
    throw new DocumentRewriteGeneratorInvalidError(
      'Rewrite generator must return exactly one of replacementText, replacementLiteXML, or replacementBlock',
    );
  }
  const replacement = (hasText ? output.replacementText : output.replacementLiteXML) as
    string | undefined;
  if (
    replacement !== undefined &&
    outputBytes(replacement) > DOCUMENT_REWRITE_MAX_GENERATED_OUTPUT_BYTES
  ) {
    throw new DocumentRewriteGeneratorInvalidError('Rewrite generator output is too large');
  }
  const generationId =
    typeof output.generationId === 'string' && output.generationId.trim()
      ? output.generationId.trim().slice(0, 255)
      : undefined;
  const model =
    typeof output.model === 'string' && output.model.trim()
      ? output.model.trim().slice(0, 255)
      : undefined;
  const provider =
    typeof output.provider === 'string' && output.provider.trim()
      ? output.provider.trim().slice(0, 255)
      : undefined;
  return {
    ...(hasBlock ? { replacementBlock: output.replacementBlock } : {}),
    ...(hasText ? { replacementText: output.replacementText as string } : {}),
    ...(hasLiteXML ? { replacementLiteXML: output.replacementLiteXML as string } : {}),
    ...(generationId ? { generationId } : {}),
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
  } as NormalizedRewriteOutput;
};

const hasHtmlTag = (source: string, tag: string): boolean =>
  new RegExp(`<${tag}\\b`, 'iu').test(source);

const hasHtmlClosingTag = (source: string, tag: string): boolean =>
  new RegExp(`</${tag}\\s*>`, 'iu').test(source);

const countHtmlOpeningTags = (source: string, tag: string): number =>
  source.match(new RegExp(`<${tag}\\b`, 'giu'))?.length ?? 0;

const countHtmlClosingTags = (source: string, tag: string): number =>
  source.match(new RegExp(`</${tag}\\s*>`, 'giu'))?.length ?? 0;

/**
 * A node adapter owns an atomic source, so a syntactically valid fragment
 * must not be allowed to replace a complete Artifact document. Validate the
 * source envelope at the worker boundary before entering the write command;
 * the adapter still performs its own final node/type validation in the room.
 */
const assertCompleteAdapterNodeOutput = (
  target: CollaborativeAgentBlockRewriteTarget,
  output: RewriteBlockOutput,
  diagnostics?: RewriteGeneratorDiagnostics,
): void => {
  if (target.adapterId === 'block-image') {
    if (output.kind !== 'patch') {
      throw new DocumentRewriteGeneratorInvalidError(
        'Block image rewrite must return a patch output',
      );
    }
    const allowedKeys = new Set(['altText', 'height', 'maxWidth', 'src', 'width']);
    if (Object.keys(output.patch).some((key) => !allowedKeys.has(key))) {
      throw new DocumentRewriteGeneratorInvalidError(
        'Block image rewrite returned an unsupported patch field',
      );
    }
    if (
      typeof output.patch.src !== 'string' ||
      (!output.patch.src.startsWith('/') && !/^https?:\/\//iu.test(output.patch.src)) ||
      output.patch.src.startsWith('//') ||
      /^data:|^blob:/iu.test(output.patch.src)
    ) {
      throw new DocumentRewriteGeneratorInvalidError(
        'Block image rewrite returned an invalid image source',
      );
    }
    for (const key of ['width', 'height', 'maxWidth'] as const) {
      const value = output.patch[key];
      if (
        value !== undefined &&
        (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      ) {
        throw new DocumentRewriteGeneratorInvalidError(
          `Block image rewrite returned an invalid ${key}`,
        );
      }
    }
    if (output.patch.altText !== undefined && typeof output.patch.altText !== 'string') {
      throw new DocumentRewriteGeneratorInvalidError(
        'Block image rewrite returned invalid altText',
      );
    }
    return;
  }

  // Other adapters (code blocks, links, and CodeMirror) intentionally accept
  // source/patch payloads whose shape is defined by that adapter. This guard
  // is only for HTML Artifact documents, where `<title>…</title>` can erase a
  // live game while remaining valid HTML.
  if (target.adapterId !== 'artifact' || output.kind !== 'source') return;

  const currentSource = target.source || '';
  const nextSource = output.source;
  if (nextSource.trim().length === 0) {
    throw new DocumentRewriteArtifactIncompleteError(
      'Artifact rewrite output must contain a complete source replacement',
      diagnostics,
    );
  }
  if (hasHtmlTag(currentSource, '!doctype') && !hasHtmlTag(nextSource, '!doctype')) {
    throw new DocumentRewriteArtifactIncompleteError(
      'Artifact rewrite output dropped the document type declaration',
      diagnostics,
    );
  }
  for (const tag of ['html', 'head', 'body']) {
    const currentHasPair = hasHtmlTag(currentSource, tag) && hasHtmlClosingTag(currentSource, tag);
    if (currentHasPair && (!hasHtmlTag(nextSource, tag) || !hasHtmlClosingTag(nextSource, tag))) {
      throw new DocumentRewriteArtifactIncompleteError(
        `Artifact rewrite output dropped the complete ${tag} section`,
        diagnostics,
      );
    }
  }
  for (const tag of ['style', 'script']) {
    const currentOpeningCount = countHtmlOpeningTags(currentSource, tag);
    const currentClosingCount = countHtmlClosingTags(currentSource, tag);
    if (
      countHtmlOpeningTags(nextSource, tag) < currentOpeningCount ||
      countHtmlClosingTags(nextSource, tag) < currentClosingCount
    ) {
      throw new DocumentRewriteArtifactIncompleteError(
        `Artifact rewrite output dropped an existing ${tag} block`,
        diagnostics,
      );
    }
  }
};

const invokeGenerator = (
  generator: RewriteGeneratorLike,
  input: RewriteGeneratorInput,
): Promise<RewriteGeneratorOutput> =>
  typeof generator === 'function'
    ? Promise.resolve(generator(input))
    : typeof generator.generate === 'function'
      ? Promise.resolve(generator.generate(input))
      : Promise.reject(
          new DocumentRewriteGeneratorInvalidError(
            'Rewrite generator has neither generate nor generateStream',
          ),
        );

const invokeGeneratorStream = (
  generator: RewriteGenerator,
  input: RewriteGeneratorInput,
  onChunk: RewriteGeneratorChunkHandler,
): Promise<RewriteGeneratorOutput> =>
  Promise.resolve(generator.generateStream?.(input, onChunk)).then((output) => {
    if (!output) {
      throw new DocumentRewriteGeneratorInvalidError(
        'Rewrite streaming generator returned no final metadata',
      );
    }
    return output;
  });

const normalizeStreamMetadata = (
  output: unknown,
): Omit<RewriteGeneratorOutput, 'replacementBlock' | 'replacementText' | 'replacementLiteXML'> &
  Partial<
    Pick<RewriteGeneratorOutput, 'replacementBlock' | 'replacementText' | 'replacementLiteXML'>
  > => {
  if (!isRecord(output)) {
    throw new DocumentRewriteGeneratorInvalidError(
      'Rewrite streaming generator returned a non-object result',
    );
  }
  const replacementText =
    typeof output.replacementText === 'string' ? output.replacementText : undefined;
  const replacementLiteXML =
    typeof output.replacementLiteXML === 'string' ? output.replacementLiteXML : undefined;
  const replacementBlock = isRewriteBlockOutput(output.replacementBlock)
    ? output.replacementBlock
    : undefined;
  if (output.replacementBlock !== undefined && replacementBlock === undefined) {
    throw new DocumentRewriteGeneratorInvalidError(
      'Rewrite generator returned an invalid block output',
    );
  }
  if (
    Number(replacementText !== undefined) +
      Number(replacementLiteXML !== undefined) +
      Number(replacementBlock !== undefined) >
    1
  ) {
    throw new DocumentRewriteGeneratorInvalidError(
      'Rewrite streaming generator returned multiple output formats',
    );
  }
  if (replacementText !== undefined && replacementLiteXML !== undefined) {
    throw new DocumentRewriteGeneratorInvalidError(
      'Rewrite streaming generator returned both replacement formats',
    );
  }
  for (const replacement of [replacementText, replacementLiteXML]) {
    if (
      replacement !== undefined &&
      outputBytes(replacement) > DOCUMENT_REWRITE_MAX_GENERATED_OUTPUT_BYTES
    ) {
      throw new DocumentRewriteGeneratorInvalidError('Rewrite generator output is too large');
    }
  }
  const generationId =
    typeof output.generationId === 'string' && output.generationId.trim()
      ? output.generationId.trim().slice(0, 255)
      : undefined;
  const model =
    typeof output.model === 'string' && output.model.trim()
      ? output.model.trim().slice(0, 255)
      : undefined;
  const provider =
    typeof output.provider === 'string' && output.provider.trim()
      ? output.provider.trim().slice(0, 255)
      : undefined;
  return {
    ...(generationId ? { generationId } : {}),
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(replacementBlock !== undefined ? { replacementBlock } : {}),
    ...(replacementText !== undefined ? { replacementText } : {}),
    ...(replacementLiteXML !== undefined ? { replacementLiteXML } : {}),
  };
};

const getStreamingRewriteStart = (
  editor: CollaborativeAgentEditorSession,
): CollaborativeAgentStreamingRewriteStart | undefined => {
  const candidateEditor = editor as CollaborativeAgentEditorSession & {
    startRewriteStream?: CollaborativeAgentStreamingRewriteStart;
    startStreamingRewrite?: CollaborativeAgentStreamingRewriteStart;
    startStreamingSession?: CollaborativeAgentStreamingRewriteStart;
  };
  const candidates = [
    candidateEditor.startStreamingRewrite,
    candidateEditor.startRewriteStream,
    candidateEditor.startStreamingSession,
  ];
  const candidate = candidates.find((value) => typeof value === 'function');
  return typeof candidate === 'function' ? candidate.bind(editor) : undefined;
};

const inspectRewriteTargets = async (
  editor: CollaborativeAgentEditorSession,
  targetNodeIds: ReadonlyArray<string>,
): Promise<CollaborativeAgentRewriteTargetInspection | undefined> => {
  const candidate = (
    editor as CollaborativeAgentEditorSession & {
      inspectRewriteTargets?: (
        targetNodeIds: ReadonlyArray<string>,
      ) =>
        | CollaborativeAgentRewriteTargetInspection
        | Promise<CollaborativeAgentRewriteTargetInspection>;
    }
  ).inspectRewriteTargets;
  if (typeof candidate !== 'function') return undefined;
  const result = await candidate.call(editor, targetNodeIds);
  if (!isRecord(result)) return undefined;
  const existingNodeIds = result.existingNodeIds;
  const missingNodeIds = result.missingNodeIds;
  if (
    !Array.isArray(existingNodeIds) ||
    !existingNodeIds.every((nodeId) => typeof nodeId === 'string') ||
    !Array.isArray(missingNodeIds) ||
    !missingNodeIds.every((nodeId) => typeof nodeId === 'string')
  ) {
    return undefined;
  }
  return { existingNodeIds, missingNodeIds };
};

const asChunk = (value: unknown): RewriteGeneratorChunk => {
  if (typeof value === 'string') return { text: value };
  if (!isRecord(value) || typeof value.text !== 'string') {
    throw new DocumentRewriteGeneratorInvalidError(
      'Rewrite streaming generator emitted an invalid chunk',
    );
  }
  const sequence = value.sequence;
  const chunkId = value.chunkId;
  return {
    ...(typeof chunkId === 'string' && chunkId.trim() ? { chunkId: chunkId.trim() } : {}),
    ...(typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence > 0
      ? { sequence }
      : {}),
    text: value.text,
  };
};

const splitGeneratedText = (text: string, chunkSize = 24): string[] => {
  const codePoints = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < codePoints.length; index += chunkSize) {
    chunks.push(codePoints.slice(index, index + chunkSize).join(''));
  }
  return chunks;
};

const isCombiningMark = (character: string): boolean => /\p{Mark}/u.test(character);

/**
 * Segment text without ever splitting a user-visible grapheme. Native
 * Intl.Segmenter is available in supported Node runtimes; the fallback keeps
 * surrogate pairs, combining marks and ZWJ sequences together for older
 * runtimes used by local test tooling.
 */
export const segmentRewriteGraphemes = (text: string): string[] => {
  if (text.length === 0) return [];
  try {
    if (typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(segmenter.segment(text), ({ segment }) => segment);
    }
  } catch {
    // Fall through to the dependency-free segmenter below.
  }

  const result: string[] = [];
  for (const character of Array.from(text)) {
    const previous = result.at(-1) ?? '';
    if (character === '\u200D' || isCombiningMark(character) || previous.endsWith('\u200D')) {
      if (result.length === 0) result.push(character);
      else result[result.length - 1] += character;
    } else {
      result.push(character);
    }
  }
  return result;
};

const isPunctuationGrapheme = (grapheme: string): boolean => /\p{P}/u.test(grapheme);

const graphemePacingDelay = (grapheme: string, baseMs: number): number =>
  isPunctuationGrapheme(grapheme)
    ? Math.min(120, Math.max(baseMs, Math.round(baseMs * 1.75)))
    : baseMs;

const mayExtendGrapheme = (grapheme: string): boolean => {
  const last = Array.from(grapheme).at(-1);
  return Boolean(
    last &&
    (last === '\u200D' ||
      isCombiningMark(last) ||
      last === '\uFE0E' ||
      last === '\uFE0F' ||
      /[\u{1F3FB}-\u{1F3FF}]/u.test(last)),
  );
};

interface PendingStreamingChunk {
  chunkId: string;
  text: string;
}

/**
 * Pace provider output independently from provider callback cadence. The
 * provider may return one complete sentence synchronously; this queue still
 * emits one intact grapheme every 35–60ms, while the read side only performs a
 * bounded synchronous enqueue. `flush()` waits for the paced drain and is the
 * single place that surfaces append errors.
 */
class StreamingChunkPump {
  private readonly batchSize: number;
  private readonly pacingMs: number;
  private readonly generationId: string;
  private readonly append: CollaborativeAgentStreamingRewriteSession['append'];
  private readonly onError?: (error: unknown) => void;
  private readonly seenSourceChunks = new Map<string, string>();
  private pending: PendingStreamingChunk[] = [];
  private rawTail = '';
  private rawTailTimer: ReturnType<typeof setTimeout> | undefined;
  private sourceSequence = 0;
  private graphemeSequence = 0;
  private pendingBytes = 0;
  private error: unknown;
  private wroteChunk = false;
  private writeAttempted = false;
  private accumulatedText = '';
  private drainPromise: Promise<void> | undefined;
  private wakeDrain: (() => void) | undefined;
  private nextWriteAt = 0;

  constructor(
    append: CollaborativeAgentStreamingRewriteSession['append'],
    generationId: string,
    pacingMs: number,
    batchSize: number,
    onError?: (error: unknown) => void,
  ) {
    this.batchSize = batchSize;
    this.append = append;
    this.pacingMs = pacingMs;
    this.generationId = generationId;
    this.onError = onError;
  }

  get hasWritten(): boolean {
    return this.wroteChunk;
  }

  get hasPending(): boolean {
    return this.pending.length > 0 || this.rawTail.length > 0;
  }

  get hasAttemptedWrite(): boolean {
    return this.writeAttempted;
  }

  get queuedBytes(): number {
    return this.pendingBytes;
  }

  get text(): string {
    return this.accumulatedText;
  }

  push = (value: unknown): Promise<void> => {
    if (this.error) return Promise.reject(this.error);
    const chunk = asChunk(value);
    if (chunk.text.length === 0) return Promise.resolve();
    const sourceId =
      chunk.chunkId ?? `${this.generationId}:source:${chunk.sequence ?? ++this.sourceSequence}`;
    const previous = this.seenSourceChunks.get(sourceId);
    if (previous !== undefined) {
      if (previous !== chunk.text) {
        const error = new DocumentRewriteGeneratorInvalidError('Rewrite chunk id was reused');
        this.fail(error);
        return Promise.reject(error);
      }
      return Promise.resolve();
    }
    this.seenSourceChunks.set(sourceId, chunk.text);

    if (
      outputBytes(this.accumulatedText) +
        this.pendingBytes +
        outputBytes(this.rawTail) +
        outputBytes(chunk.text) >
      DOCUMENT_REWRITE_MAX_GENERATED_OUTPUT_BYTES
    ) {
      const error = new DocumentRewriteGeneratorInvalidError(
        'Rewrite generator output is too large',
      );
      this.fail(error);
      return Promise.reject(error);
    }

    this.clearRawTailTimer();
    // Keep one tail grapheme until the next provider frame (or flush) when it
    // can still be extended by a combining mark/ZWJ. A normal tail is only a
    // finite lookbehind: release it after one pacing interval so a single
    // provider frame cannot leave the first visible character waiting for a
    // later frame or finalization.
    const combined = this.rawTail + chunk.text;
    const segments = segmentRewriteGraphemes(combined);
    const tail = segments.pop();
    this.rawTail = tail ?? '';
    for (const grapheme of segments) {
      this.enqueueGrapheme(grapheme);
    }
    if (this.rawTail && !mayExtendGrapheme(this.rawTail)) this.scheduleRawTailRelease();
    this.ensureDrain();
    return Promise.resolve();
  };

  flush = async (): Promise<void> => {
    if (this.rawTail.length > 0) {
      this.releaseRawTail();
    }
    this.ensureDrain();
    await this.drainPromise;
    if (this.error) throw this.error;
  };

  fail = (error: unknown): void => {
    if (!this.error) {
      this.error = error;
      this.onError?.(error);
    }
    this.pending.splice(0);
    this.pendingBytes = 0;
    this.clearRawTailTimer();
    this.rawTail = '';
    this.wakeDrain?.();
    this.wakeDrain = undefined;
  };

  private enqueueGrapheme = (text: string): void => {
    if (this.error || text.length === 0) return;
    const graphemeId = `${this.generationId}:grapheme:${this.graphemeSequence++}`;
    const bytes = outputBytes(text);
    if (
      outputBytes(this.accumulatedText) + this.pendingBytes + bytes >
      DOCUMENT_REWRITE_MAX_GENERATED_OUTPUT_BYTES
    ) {
      this.fail(new DocumentRewriteGeneratorInvalidError('Rewrite generator output is too large'));
      return;
    }
    this.pending.push({ chunkId: graphemeId, text });
    this.pendingBytes += bytes;
  };

  private clearRawTailTimer = (): void => {
    if (!this.rawTailTimer) return;
    clearTimeout(this.rawTailTimer);
    this.rawTailTimer = undefined;
  };

  private scheduleRawTailRelease = (): void => {
    this.clearRawTailTimer();
    this.rawTailTimer = setTimeout(() => {
      this.rawTailTimer = undefined;
      this.releaseRawTail();
    }, this.pacingMs);
    (this.rawTailTimer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  };

  private releaseRawTail = (): void => {
    this.clearRawTailTimer();
    const tail = this.rawTail;
    this.rawTail = '';
    if (!tail || this.error) return;
    this.enqueueGrapheme(tail);
    this.ensureDrain();
  };

  private ensureDrain = (): void => {
    if (this.drainPromise) return;
    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = undefined;
      if (this.pending.length > 0 && !this.error) this.ensureDrain();
    });
    void this.drainPromise.catch(() => undefined);
  };

  private wait = async (delayMs: number): Promise<void> => {
    if (delayMs <= 0 || this.error) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.wakeDrain = undefined;
        resolve();
      }, delayMs);
      this.wakeDrain = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.wakeDrain = undefined;
        resolve();
      };
      (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    });
  };

  private drain = async (): Promise<void> => {
    while (this.pending.length > 0 && !this.error) {
      const waitMs = Math.max(0, this.nextWriteAt - Date.now());
      await this.wait(waitMs);
      if (this.error) return;
      const batch: PendingStreamingChunk[] = [];
      while (batch.length < this.batchSize && this.pending.length > 0) {
        const next = this.pending.shift();
        if (!next) break;
        batch.push(next);
        this.pendingBytes = Math.max(0, this.pendingBytes - outputBytes(next.text));
        // Markdown's text writer inserts a visual space after punctuation at
        // a TextNode boundary. Keep one following grapheme in this batch so
        // punctuation such as the hyphen in "cross-segment" is never
        // serialized as "cross- segment" in a durable projection.
        if (
          batch.length >= this.batchSize &&
          isPunctuationGrapheme(next.text) &&
          this.pending.length > 0
        ) {
          const following = this.pending.shift();
          if (following) {
            batch.push(following);
            this.pendingBytes = Math.max(0, this.pendingBytes - outputBytes(following.text));
          }
        }
      }
      if (batch.length === 0) return;
      const text = batch.map(({ text: grapheme }) => grapheme).join('');
      const payload: CollaborativeAgentStreamingRewriteChunk = {
        chunkId:
          batch.length === 1
            ? batch[0].chunkId
            : `${this.generationId}:batch:${batch[0].chunkId}-${batch.at(-1)?.chunkId}`,
        text,
      };
      try {
        this.writeAttempted = true;
        const result = await this.append(payload);
        if (this.error) return;
        const status = commandStatus(result as RewriteCommandResult | undefined);
        const error = isRecord(result) && typeof result.error === 'string' ? result.error : '';
        if (status === 'stale')
          throw new DocumentRewriteStaleError('Rewrite stream target changed');
        if (status === 'conflict') {
          if (/region[_ -]?missing|target.+(?:deleted|missing)/i.test(error)) {
            throw new DocumentRewriteRegionMissingError();
          }
          throw new DocumentRewriteGenerationConflictError(
            error || 'Rewrite stream target changed',
          );
        }
        if (status === 'stopped' || status === 'aborted') {
          if (/region[_ -]?missing|target.+(?:deleted|missing)/i.test(error)) {
            throw new DocumentRewriteRegionMissingError();
          }
          throw new DocumentRewriteStreamingTransportError(error || 'Rewrite stream stopped');
        }
        if (status === 'failed') {
          if (/region[_ -]?missing/i.test(error)) throw new DocumentRewriteRegionMissingError();
          if (/generation[_ -]?mismatch|conflict/i.test(error)) {
            throw new DocumentRewriteGenerationConflictError();
          }
          throw new DocumentRewriteCommandFailedError(error || 'Rewrite stream append failed');
        }
        this.wroteChunk = true;
        this.accumulatedText += text;
        this.nextWriteAt = Date.now() + graphemePacingDelay(text, this.pacingMs);
      } catch (error) {
        this.error = error;
        this.pending.splice(0);
        this.pendingBytes = 0;
        this.onError?.(error);
        throw error;
      }
    }
  };
}

interface LeaseGuard {
  assert: () => Promise<void>;
  lost: () => boolean;
  stop: () => void;
}

const createLeaseGuard = (
  service: DocumentRewriteRequestLifecycle,
  requestId: string,
  attempt: number,
  workerId: string,
  leaseMs: number,
  logger: Pick<Console, 'warn'>,
): LeaseGuard => {
  let leaseLost = false;
  const intervalMs = Math.max(250, Math.floor(leaseMs / 3));
  const timer = setInterval(() => {
    void service
      .renewLease(requestId, { attempt, leaseMs, workerId })
      .then((renewed) => {
        if (!renewed) {
          leaseLost = true;
          logger.warn(`Document rewrite lease lost request=${requestId} attempt=${attempt}`);
        }
      })
      .catch((error: unknown) => {
        // A single transient heartbeat failure must not abort a still-live
        // lease. The next heartbeat or the pre-command assertion is decisive.
        logger.warn(
          `Document rewrite lease renewal failed request=${requestId}: ${asMessage(error)}`,
        );
      });
  }, intervalMs);
  (timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();

  return {
    assert: async () => {
      if (leaseLost) throw new DocumentRewriteLeaseLostError();
      const renewed = await service.renewLease(requestId, { attempt, leaseMs, workerId });
      if (!renewed) {
        leaseLost = true;
        throw new DocumentRewriteLeaseLostError();
      }
    },
    lost: () => leaseLost,
    stop: () => clearInterval(timer),
  };
};

const setAwareness = (
  editor: CollaborativeAgentEditorSession,
  request: DocumentRewriteRequestItem,
  status: AgentAwarenessStatus,
  selection?: DocumentRewriteSelection,
): void => {
  // Atomic card endpoints (0..1) identify a node, not a text range. Sending
  // them through Lexical/Yjs text projection selects card UI and can span
  // adjacent blocks. Keep presence/leases, but publish no text cursor.
  const isNodeTarget = request.selection.targetKind === 'node';
  const relative = !isNodeTarget && selection?.kind === 'relative' ? selection : undefined;
  let anchorPos: AgentAwarenessInput['anchorPos'];
  let focusPos: AgentAwarenessInput['focusPos'];
  if (relative) {
    try {
      anchorPos = deserializeRelativePosition(relative.anchorPos as never);
      focusPos = deserializeRelativePosition(relative.focusPos as never);
    } catch {
      // Awareness without a range is safer than publishing malformed Yjs
      // positions. Selection resolution still performs the strict check.
      anchorPos = null;
      focusPos = null;
    }
  }
  const state: AgentAwarenessInput = {
    ...(isNodeTarget ? { anchorPos: null, focusPos: null, caret: null } : {}),
    ...(relative ? { anchorPos: anchorPos ?? null, focusPos: focusPos ?? anchorPos ?? null } : {}),
    color: '#7c3aed',
    documentId: request.documentId,
    focusing: !isNodeTarget && status !== 'done' && status !== 'error',
    ...(request.generationId ? { generationId: request.generationId } : {}),
    name: 'AI Agent',
    requestId: request.id,
    ...(!isNodeTarget &&
    selection?.kind === 'block' &&
    typeof selection.startNodeId === 'string' &&
    typeof selection.endNodeId === 'string' &&
    typeof selection.startOffset === 'number' &&
    typeof selection.endOffset === 'number'
      ? {
          selectionRange: {
            startNodeId: selection.startNodeId,
            startOffset: selection.startOffset,
            endNodeId: selection.endNodeId,
            endOffset: selection.endOffset,
          },
        }
      : {}),
    ...(selection?.targetNodeIds ? { targetNodeIds: selection.targetNodeIds } : {}),
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    status,
  };
  if (editor.setAgentAwareness) {
    editor.setAgentAwareness(state);
    return;
  }
  editor.setAgentStatus?.(status);
};

const trySetAwareness = (
  editor: CollaborativeAgentEditorSession,
  request: DocumentRewriteRequestItem,
  status: AgentAwarenessStatus,
  selection: DocumentRewriteSelection,
  logger: Pick<Console, 'warn'>,
): void => {
  try {
    setAwareness(editor, request, status, selection);
  } catch (error) {
    // Awareness is user feedback, not the write authority. A provider that
    // only accepts awareness after auth must not make the rewrite fail.
    logger.warn(`Document rewrite awareness update failed: ${asMessage(error)}`);
  }
};

/** FNV-1a used by pre-normalization editor bundles for a captured quote. */
const hashRawRewriteText = (text: string): string => {
  let hash = 2_166_136_261;
  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const selectionHashMatches = (
  selection: { quotedText: string; quotedTextHash?: string },
  resolved: RewriteResolvedSelection,
): boolean => {
  // The browser and Lexical use a block separator for cross-paragraph
  // selections while the Page request/composer may carry the same quote with
  // a transport space. Compare the canonical proof text, then its stable hash;
  // raw string equality would reject an otherwise unchanged Cmd/Ctrl+A range
  // after a browser/provider boundary.
  if (normalizeRewriteText(resolved.quotedText) !== normalizeRewriteText(selection.quotedText)) {
    return false;
  }
  return (
    (typeof selection.quotedTextHash === 'string' &&
      hashRewriteText(resolved.quotedText) === selection.quotedTextHash) ||
    // Accept only the legacy hash for the same canonical quote. This keeps
    // requests created by an older Page bundle recoverable without weakening
    // the text-equality guard above.
    (typeof selection.quotedTextHash === 'string' &&
      hashRawRewriteText(selection.quotedText) === selection.quotedTextHash)
  );
};

/**
 * A full-block Markdown replacement can preserve the durable block id while
 * replacing its Paragraph with a List. In that case the original relative
 * anchors point at deleted structure; use the generated session's live text
 * range as a narrow, hash-checked fallback. Adapter-owned node sources never
 * enter this path.
 */
interface RewriteSelectionResolution {
  rebased: boolean;
  resolved: RewriteResolvedSelection | null;
}

const resolveRewriteSelectionWithSource = (
  editor: CollaborativeAgentEditorSession,
  selection: RewriteSelection,
  provenanceSessionId?: string | null,
): RewriteSelectionResolution => {
  const resolved = editor.resolveSelection(selection);
  const targetKind = (selection as unknown as { targetKind?: unknown }).targetKind;
  if (targetKind === 'node' || !provenanceSessionId) return { rebased: false, resolved };
  if (resolved && selectionHashMatches(selection, resolved)) {
    return { rebased: false, resolved };
  }

  const relocated = editor.resolveSelectionByProvenance?.(
    provenanceSessionId,
    selection.quotedTextHash,
    selection.targetNodeIds,
  );
  return { rebased: Boolean(relocated), resolved: relocated ?? resolved };
};

const resolveRewriteSelection = (
  editor: CollaborativeAgentEditorSession,
  selection: RewriteSelection,
  provenanceSessionId?: string | null,
): RewriteResolvedSelection | null =>
  resolveRewriteSelectionWithSource(editor, selection, provenanceSessionId).resolved;

const resolvedSelectionPayload = (
  resolved: RewriteResolvedSelection,
): BlockRewriteSelection | null => {
  if (
    !resolved.startNodeId ||
    !resolved.endNodeId ||
    resolved.startOffset === undefined ||
    resolved.endOffset === undefined
  ) {
    return null;
  }
  return {
    baseStateVector: resolved.baseStateVector,
    endNodeId: resolved.endNodeId,
    endOffset: resolved.endOffset,
    kind: 'block',
    quotedText: normalizeRewriteText(resolved.quotedText),
    quotedTextHash: hashRewriteText(resolved.quotedText),
    startNodeId: resolved.startNodeId,
    startOffset: resolved.startOffset,
    targetNodeIds: resolved.targetNodeIds,
  };
};

const serviceFromRow = (
  db: LobeChatDatabase,
  request: DocumentRewriteRequestItem,
): DocumentRewriteRequestLifecycle =>
  new DocumentRewriteRequestService(db, request.requestedByUserId, request.workspaceId);

/**
 * Durable targeted-rewrite worker. Every delivery is re-read and claimed by
 * `(requestId, attempt, workerId)` before it can connect to a room. The only
 * document mutation in this class is the allowlisted rewrite command dispatched
 * through CollaborativeAgentEditor.
 */
export class DocumentRewriteWorker {
  private readonly db?: LobeChatDatabase;
  private readonly collaborationWsUrl?: string;
  private readonly editorFactory: CollaborativeAgentEditorFactory;
  private readonly generator?: RewriteGeneratorLike;
  private readonly generatorFactory?: RewriteGeneratorFactory;
  private readonly leaseMs: number;
  private readonly logger: Pick<Console, 'error' | 'info' | 'warn'>;
  private readonly maxAttempts: number;
  private readonly queue?: DocumentRewriteQueue;
  private readonly requestService?: DocumentRewriteRequestLifecycle;
  private readonly requestServiceFactory?: DocumentRewriteWorkerOptions['requestServiceFactory'];
  private readonly retryBackoffMs: (attempt: number, error: unknown) => number;
  private readonly workerId: string;
  private readonly blockRewriteCommand?: CollaborativeAgentCommand;
  private readonly cancellationPollMs: number;
  private readonly connectTimeoutMs: number;
  private readonly syncTimeoutMs: number;
  private readonly directPersistenceTimeoutMs: number;
  private readonly directPersistencePollMs: number;
  private readonly streamingGraphemeBatchSize: number;
  private readonly streamingFlushMs: number;
  private readonly streamingGraphemePacingMs: number;

  constructor(options: DocumentRewriteWorkerOptions) {
    if (!options.generator && !options.generatorFactory) {
      throw new Error(DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED);
    }
    if (!options.db && !options.requestService && !options.requestServiceFactory) {
      throw new Error('DocumentRewriteWorker requires db or requestService');
    }
    this.db = options.db;
    this.blockRewriteCommand = options.blockRewriteCommand;
    this.collaborationWsUrl = options.collaborationWsUrl?.trim() || undefined;
    this.editorFactory = options.editorFactory ?? defaultEditorFactory;
    this.generator = options.generator;
    this.generatorFactory = options.generatorFactory;
    this.leaseMs = Math.max(
      1_000,
      Math.min(
        Math.trunc(options.leaseMs ?? DOCUMENT_REWRITE_WORKER_DEFAULT_LEASE_MS),
        15 * 60_000,
      ),
    );
    this.logger = options.logger ?? console;
    this.maxAttempts = Math.max(
      1,
      Math.min(Math.trunc(options.maxAttempts ?? DOCUMENT_REWRITE_DEFAULT_MAX_ATTEMPTS), 100),
    );
    this.queue = options.queue;
    this.requestService = options.requestService;
    this.requestServiceFactory = options.requestServiceFactory;
    this.retryBackoffMs =
      options.retryBackoffMs ??
      ((attempt) =>
        Math.min(
          DOCUMENT_REWRITE_DEFAULT_RETRY_BACKOFF_MS * 2 ** Math.max(0, attempt - 1),
          60_000,
        ));
    this.workerId =
      options.workerId?.trim() ||
      `document-rewrite-worker:${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    this.cancellationPollMs = Math.max(
      50,
      Math.min(
        Math.trunc(options.cancellationPollMs ?? DOCUMENT_REWRITE_DEFAULT_CANCELLATION_POLL_MS),
        10_000,
      ),
    );
    this.connectTimeoutMs = Math.max(
      1,
      Math.min(
        Math.trunc(options.connectTimeoutMs ?? DOCUMENT_REWRITE_DEFAULT_CONNECT_TIMEOUT_MS),
        10 * 60_000,
      ),
    );
    this.syncTimeoutMs = Math.max(
      1,
      Math.min(
        Math.trunc(options.syncTimeoutMs ?? DOCUMENT_REWRITE_DEFAULT_SYNC_TIMEOUT_MS),
        10 * 60_000,
      ),
    );
    this.directPersistenceTimeoutMs = Math.max(
      1,
      Math.min(
        Math.trunc(
          options.directPersistenceTimeoutMs ??
            DOCUMENT_REWRITE_DEFAULT_DIRECT_PERSISTENCE_TIMEOUT_MS,
        ),
        10 * 60_000,
      ),
    );
    this.directPersistencePollMs = Math.max(
      1,
      Math.min(
        Math.trunc(
          options.directPersistencePollMs ?? DOCUMENT_REWRITE_DEFAULT_DIRECT_PERSISTENCE_POLL_MS,
        ),
        10_000,
      ),
    );
    this.streamingFlushMs = Math.min(
      DOCUMENT_REWRITE_MAX_STREAMING_FLUSH_MS,
      Math.max(
        DOCUMENT_REWRITE_MIN_STREAMING_FLUSH_MS,
        Math.trunc(options.streamingFlushMs ?? DOCUMENT_REWRITE_DEFAULT_STREAMING_FLUSH_MS),
      ),
    );
    const configuredGraphemePacing =
      options.streamingGraphemePacingMs ??
      options.streamingFlushMs ??
      Number(process.env[DOCUMENT_REWRITE_GRAPHEME_PACING_MS_ENV]);
    const graphemePacing = Number.isFinite(configuredGraphemePacing)
      ? Math.trunc(configuredGraphemePacing)
      : DOCUMENT_REWRITE_DEFAULT_GRAPHEME_PACING_MS;
    this.streamingGraphemePacingMs = Math.min(
      DOCUMENT_REWRITE_MAX_GRAPHEME_PACING_MS,
      Math.max(DOCUMENT_REWRITE_MIN_GRAPHEME_PACING_MS, graphemePacing),
    );
    const configuredGraphemeBatchSize =
      options.streamingGraphemeBatchSize ??
      Number(process.env[DOCUMENT_REWRITE_GRAPHEME_BATCH_SIZE_ENV]);
    const graphemeBatchSize = Number.isFinite(configuredGraphemeBatchSize)
      ? Math.trunc(configuredGraphemeBatchSize)
      : DOCUMENT_REWRITE_DEFAULT_GRAPHEME_BATCH_SIZE;
    this.streamingGraphemeBatchSize = Math.min(
      DOCUMENT_REWRITE_MAX_GRAPHEME_BATCH_SIZE,
      Math.max(DOCUMENT_REWRITE_MIN_GRAPHEME_BATCH_SIZE, graphemeBatchSize),
    );
  }

  private findInitialRequest = async (
    requestId: string,
  ): Promise<DocumentRewriteRequestItem | undefined> => {
    if (this.requestService) return this.requestService.findById(requestId);
    if (this.requestServiceFactory) {
      // A factory-only worker still needs a global lookup to discover the
      // request's user/workspace scope. It is intentionally DB-backed.
    }
    if (!this.db) return undefined;
    const [request] = await this.db
      .select()
      .from(documentRewriteRequests)
      .where(eq(documentRewriteRequests.id, requestId))
      .limit(1);
    return request;
  };

  private serviceFor = (request: DocumentRewriteRequestItem): DocumentRewriteRequestLifecycle => {
    if (this.requestService) return this.requestService;
    if (this.requestServiceFactory) return this.requestServiceFactory(request);
    if (this.db) return serviceFromRow(this.db, request);
    throw new Error('DocumentRewriteWorker request service is unavailable');
  };

  private loadPersistedDocumentSnapshot = async (
    request: DocumentRewriteRequestItem,
  ): Promise<PersistedDocumentSnapshot | undefined> => {
    if (!this.db) return undefined;

    try {
      const document = await new DocumentModel(
        this.db,
        request.requestedByUserId,
        request.workspaceId ?? undefined,
      ).findById(request.documentId);
      if (!document) return undefined;

      return {
        content: document.content ?? null,
        documentId: document.id,
        editorData: document.editorData,
        title: document.title ?? null,
      };
    } catch (error) {
      this.logger.warn(
        `Document rewrite context snapshot unavailable request=${request.id}: ${asMessage(error)}`,
      );
      return undefined;
    }
  };

  /**
   * Wait until the collaboration persistence worker has recorded this direct
   * command, then atomically settle the request. The browser remains a normal
   * editable client while this loop is running; a later human edit may advance
   * the room state vector, so the database proof is request-linked history plus
   * the scoped collaboration ledger rather than an exact-vector equality.
   */
  private waitForDirectApply = async (
    service: DocumentRewriteRequestLifecycle,
    request: DocumentRewriteRequestItem,
    input: Omit<DocumentRewriteDirectApplyInput, 'attempt' | 'workerId'>,
  ): Promise<DocumentRewriteRequestItem> => {
    if (!service.markDirectApplied) {
      throw new DocumentRewriteWorkerError(
        'Direct rewrite persistence proof is not configured',
        DOCUMENT_REWRITE_DIRECT_APPLY_PROOF_INVALID,
        false,
      );
    }

    const deadline = Date.now() + this.directPersistenceTimeoutMs;
    let lastResult: DocumentRewriteRequestItem | undefined;
    while (Date.now() <= deadline) {
      const result = await service.markDirectApplied(request.id, {
        ...input,
        attempt: request.attempt,
        workerId: this.workerId,
      });
      if (result) return result.request;

      const current = await service.findById(request.id);
      if (!current || current.attempt !== request.attempt) {
        throw new DocumentRewriteLeaseLostError('Rewrite request changed before persistence proof');
      }
      lastResult = current;
      if (current.status === 'applied') return current;
      if (current.status === 'cancel_requested') {
        // Cancellation does not roll back a direct command. Keep waiting for
        // the same durable proof and let markDirectApplied settle as applied.
      } else if (current.status !== 'writing' && current.status !== 'connecting') {
        throw new DocumentRewriteLeaseLostError(
          `Rewrite request changed before persistence proof: ${current.status}`,
        );
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(this.directPersistencePollMs, remaining)),
      );
    }

    if (lastResult?.status === 'applied') return lastResult;
    throw new DocumentRewritePersistenceTimeoutError();
  };

  private sweepPendingReviews = async (): Promise<void> => {
    if (this.requestService?.sweepPendingReviews) {
      await this.requestService.sweepPendingReviews();
      return;
    }
    if (!this.db) return;

    const pending = await this.db
      .select({
        requestedByUserId: documentRewriteRequests.requestedByUserId,
        workspaceId: documentRewriteRequests.workspaceId,
      })
      .from(documentRewriteRequests)
      .where(inArray(documentRewriteRequests.status, ['awaiting_review', 'canceled_after_write']))
      .limit(2_000);
    const scopes = new Map<string, { userId: string; workspaceId?: string }>();
    for (const row of pending) {
      const workspaceId = row.workspaceId ?? undefined;
      scopes.set(`${row.requestedByUserId}\u0000${workspaceId ?? ''}`, {
        userId: row.requestedByUserId,
        workspaceId,
      });
    }
    for (const scope of scopes.values()) {
      await new DocumentRewriteRequestModel(
        this.db,
        scope.userId,
        scope.workspaceId,
      ).sweepPendingReviews();
    }
  };

  private transition = async (
    service: DocumentRewriteRequestLifecycle,
    requestId: string,
    input: Parameters<DocumentRewriteRequestLifecycle['transitionWorker']>[1],
  ): Promise<DocumentRewriteRequestItem> => {
    const result = await service.transitionWorker(requestId, input);
    if (!result) throw new DocumentRewriteLeaseLostError();
    return result.request;
  };

  private cancellation = async (
    service: DocumentRewriteRequestLifecycle,
    requestId: string,
    attempt: number,
  ): Promise<DocumentRewriteRequestItem | undefined> => {
    const current = await service.findById(requestId);
    if (!current || current.attempt !== attempt) return current;
    if (current.status !== 'cancel_requested') return current;
    return current;
  };

  private settleCancellation = async (
    service: DocumentRewriteRequestLifecycle,
    request: DocumentRewriteRequestItem,
    editor: CollaborativeAgentEditorSession | undefined,
  ): Promise<DocumentRewriteWorkerResult> => {
    if (request.status === 'cancel_requested') {
      let canceled: { isDuplicate: boolean; request: DocumentRewriteRequestItem } | undefined;
      try {
        canceled = await service.transitionWorker(request.id, {
          attempt: request.attempt,
          errorCode: DOCUMENT_REWRITE_WORKER_CANCELED,
          errorMessage: 'Document rewrite request canceled before command submission',
          status: 'canceled',
          workerId: this.workerId,
        });
      } catch {
        // A cancellation can arrive at the same moment the lease expires. Do
        // not turn that safe recovery case into a 500; the next claim will
        // settle cancel_requested after taking over/observing the lease.
        return {
          attempt: request.attempt,
          reason: DOCUMENT_REWRITE_WORKER_LEASE_LOST,
          requestId: request.id,
          status: 'deferred',
        };
      }
      if (!canceled) {
        return {
          attempt: request.attempt,
          reason: DOCUMENT_REWRITE_WORKER_LEASE_LOST,
          requestId: request.id,
          status: 'deferred',
        };
      }
      request = canceled?.request ?? request;
    }
    if (editor) {
      trySetAwareness(editor, request, 'done', request.selection, this.logger);
      editor.clearAwareness?.();
    }
    return {
      attempt: request.attempt,
      reason: DOCUMENT_REWRITE_WORKER_CANCELED,
      requestId: request.id,
      status: request.status === 'canceled' ? 'canceled' : 'ignored',
    };
  };

  private processFailure = async (
    service: DocumentRewriteRequestLifecycle,
    request: DocumentRewriteRequestItem,
    error: unknown,
  ): Promise<DocumentRewriteWorkerResult> => {
    const current = (await service.findById(request.id)) ?? request;
    if (current.attempt !== request.attempt) {
      return {
        attempt: current.attempt,
        reason: 'superseded-attempt',
        requestId: request.id,
        status: 'ignored',
      };
    }
    // Never try to transition/retry a row after losing the lease. Those
    // mutations are correctly rejected by the DB model; reporting that
    // rejection as `failed` would hide the fact that the same attempt is safe
    // to recover after its lease expires.
    if (error instanceof DocumentRewriteLeaseLostError) {
      return {
        attempt: request.attempt,
        reason: error.code,
        requestId: request.id,
        status: 'deferred',
      };
    }
    if (current.status === 'cancel_requested') {
      return this.settleCancellation(service, current, undefined);
    }
    if (isTerminalStatus(current.status) || current.status === 'awaiting_review') {
      return { attempt: current.attempt, requestId: current.id, status: current.status };
    }

    const diagnosticModel = errorDiagnosticValue(error, 'model') ?? current.model ?? undefined;
    const diagnosticProvider =
      errorDiagnosticValue(error, 'provider') ?? current.provider ?? undefined;
    const diagnosticFields = {
      ...(diagnosticModel ? { model: diagnosticModel } : {}),
      ...(diagnosticProvider ? { provider: diagnosticProvider } : {}),
    };

    if (error instanceof DocumentRewriteRegionMissingError) {
      let canceled: { isDuplicate: boolean; request: DocumentRewriteRequestItem } | undefined;
      try {
        let currentRequest = current;
        // The durable state machine only permits cancellation from
        // `cancel_requested` (or `writing -> canceled_after_write`). A region
        // deletion observed by the worker is itself a cancellation request;
        // make that intermediate intent explicit before settling the row.
        if (
          currentRequest.status !== 'queued' &&
          currentRequest.status !== 'retry_wait' &&
          currentRequest.status !== 'cancel_requested' &&
          currentRequest.status !== 'writing'
        ) {
          const requested = await service.transitionWorker(request.id, {
            attempt: request.attempt,
            errorCode: error.code,
            errorMessage: asDurableErrorMessage(error, currentRequest.errorMessage),
            status: 'cancel_requested',
            workerId: this.workerId,
          });
          if (!requested) throw new DocumentRewriteLeaseLostError();
          currentRequest = requested.request;
        }
        const canceledStatus =
          currentRequest.status === 'writing' ? 'canceled_after_write' : 'canceled';
        canceled = await service.transitionWorker(request.id, {
          attempt: request.attempt,
          errorCode: error.code,
          errorMessage: asDurableErrorMessage(error, currentRequest.errorMessage),
          status: canceledStatus,
          workerId: this.workerId,
        });
      } catch {
        const raced = await service.findById(request.id);
        if (raced?.status === 'canceled' || raced?.status === 'canceled_after_write') {
          return {
            attempt: raced.attempt,
            reason: error.code,
            requestId: raced.id,
            status: raced.status,
          };
        }
        return {
          attempt: request.attempt,
          reason: DOCUMENT_REWRITE_WORKER_LEASE_LOST,
          requestId: request.id,
          status: 'deferred',
        };
      }
      return {
        attempt: request.attempt,
        reason: error.code,
        requestId: request.id,
        status: canceled?.request.status ?? 'canceled',
      };
    }

    if (
      error instanceof DocumentRewriteStaleError ||
      error instanceof DocumentRewriteGenerationConflictError
    ) {
      let stale: { isDuplicate: boolean; request: DocumentRewriteRequestItem } | undefined;
      try {
        stale = await service.transitionWorker(request.id, {
          attempt: request.attempt,
          errorCode: error.code,
          errorMessage: asDurableErrorMessage(error, current.errorMessage),
          status: 'stale',
          workerId: this.workerId,
        });
      } catch {
        const raced = await service.findById(request.id);
        if (raced?.attempt !== request.attempt || raced?.status === 'stale') {
          return {
            attempt: raced?.attempt ?? request.attempt,
            reason: error.code,
            requestId: request.id,
            status: raced?.status === 'stale' ? 'stale' : 'ignored',
          };
        }
        return {
          attempt: request.attempt,
          reason: DOCUMENT_REWRITE_WORKER_LEASE_LOST,
          requestId: request.id,
          status: 'deferred',
        };
      }
      if (!stale) {
        const raced = await service.findById(request.id);
        return {
          attempt: raced?.attempt ?? request.attempt,
          reason: raced?.status === 'stale' ? error.code : DOCUMENT_REWRITE_WORKER_LEASE_LOST,
          requestId: request.id,
          status: raced?.status === 'stale' ? 'stale' : 'deferred',
        };
      }
      return {
        attempt: request.attempt,
        reason: error.code,
        requestId: request.id,
        status: stale?.request.status ?? 'stale',
      };
    }

    const retryable = isRetryableError(error);
    if (retryable && request.attempt < this.maxAttempts && service.retryWorker) {
      const delayMs = Math.max(
        0,
        Math.min(24 * 60 * 60_000, Math.trunc(this.retryBackoffMs(request.attempt, error))),
      );
      let retried: { isDuplicate: boolean; request: DocumentRewriteRequestItem } | undefined;
      try {
        retried = await service.retryWorker(request.id, {
          attempt: request.attempt,
          delayMs,
          errorCode: errorCode(error),
          errorMessage: asDurableErrorMessage(error, current.errorMessage),
          workerId: this.workerId,
        });
      } catch (retryError) {
        // A retry CAS/DB error is infrastructure uncertainty, not permission
        // to mark the request failed. Leave the original active row for lease
        // recovery and let the queue deliver it again.
        this.logger.error(
          `Document rewrite retry transition failed request=${request.id}: ${asMessage(retryError)}`,
        );
        return {
          attempt: request.attempt,
          reason: DOCUMENT_REWRITE_WORKER_LEASE_LOST,
          requestId: request.id,
          status: 'deferred',
        };
      }
      if (retried) {
        const nextAttempt = retried.request.attempt;
        if (this.queue) {
          try {
            await this.queue.enqueue(createDocumentRewriteQueueMessage(request.id, nextAttempt), {
              delayMs,
            });
          } catch (queueError) {
            // Keep retry_wait durable. A process restart scanner can recover
            // the row even if publishing the immediate delivery failed.
            this.logger.error(
              `Document rewrite retry enqueue failed request=${request.id}: ${asMessage(queueError)}`,
            );
          }
        }
        return {
          attempt: nextAttempt,
          reason: errorCode(error),
          requestId: request.id,
          status: 'retry_wait',
        };
      }

      // A concurrent cancel/takeover can make the atomic worker retry return
      // undefined. Reconcile before attempting a terminal transition; never
      // let a late error overwrite a cancellation or report a lost lease as a
      // fresh failure.
      const raced = await service.findById(request.id);
      if (raced?.attempt !== request.attempt) {
        return {
          attempt: raced?.attempt ?? request.attempt,
          reason: 'superseded-attempt',
          requestId: request.id,
          status: 'ignored',
        };
      }
      if (raced?.status === 'cancel_requested')
        return this.settleCancellation(service, raced, undefined);
      if (raced && isTerminalStatus(raced.status)) {
        return { attempt: raced.attempt, requestId: raced.id, status: raced.status };
      }
      if (
        raced &&
        (raced.claimOwner !== this.workerId ||
          !raced.leaseExpiresAt ||
          raced.leaseExpiresAt.getTime() <= Date.now())
      ) {
        return {
          attempt: request.attempt,
          reason: DOCUMENT_REWRITE_WORKER_LEASE_LOST,
          requestId: request.id,
          status: 'deferred',
        };
      }
    }

    let failed: { isDuplicate: boolean; request: DocumentRewriteRequestItem } | undefined;
    try {
      failed = await service.transitionWorker(request.id, {
        attempt: request.attempt,
        errorCode: errorCode(error),
        errorMessage: asDurableErrorMessage(error, current.errorMessage),
        ...diagnosticFields,
        status: 'failed',
        workerId: this.workerId,
      });
    } catch {
      const raced = await service.findById(request.id);
      if (raced?.status === 'cancel_requested')
        return this.settleCancellation(service, raced, undefined);
      if (raced?.attempt !== request.attempt) {
        return {
          attempt: raced?.attempt ?? request.attempt,
          reason: 'superseded-attempt',
          requestId: request.id,
          status: 'ignored',
        };
      }
      if (raced && (isTerminalStatus(raced.status) || raced.status === 'awaiting_review')) {
        return { attempt: raced.attempt, requestId: raced.id, status: raced.status };
      }
      return {
        attempt: request.attempt,
        reason: DOCUMENT_REWRITE_WORKER_LEASE_LOST,
        requestId: request.id,
        status: 'deferred',
      };
    }
    return {
      attempt: request.attempt,
      reason: errorCode(error),
      requestId: request.id,
      status: failed?.request.status ?? 'failed',
    };
  };

  /** Process one queue delivery. Duplicate/stale deliveries are safe no-ops. */
  process = async (message: DocumentRewriteQueueMessage): Promise<DocumentRewriteWorkerResult> => {
    const normalized = createDocumentRewriteQueueMessage(message.requestId, message.attempt);
    let initial = await this.findInitialRequest(normalized.requestId);
    if (!initial) {
      return {
        attempt: normalized.attempt,
        reason: DOCUMENT_REWRITE_REQUEST_NOT_FOUND,
        requestId: normalized.requestId,
        status: 'ignored',
      };
    }
    if (initial.attempt !== normalized.attempt) {
      return {
        attempt: initial.attempt,
        reason: 'attempt-mismatch',
        requestId: normalized.requestId,
        status: 'ignored',
      };
    }

    const service = this.serviceFor(initial);
    if (initial.status === 'retry_wait') {
      if (!service.promoteRetry) {
        return {
          attempt: initial.attempt,
          reason: 'retry-wait',
          requestId: initial.id,
          status: 'deferred',
        };
      }
      const promoted = await service.promoteRetry(initial.id, initial.attempt);
      if (!promoted) {
        initial = (await service.findById(initial.id)) ?? initial;
        return {
          attempt: initial.attempt,
          reason: 'retry-not-due',
          requestId: initial.id,
          status: initial.status === 'queued' ? 'ignored' : 'deferred',
        };
      }
      initial = promoted;
    }
    if (isTerminalStatus(initial.status) || initial.status === 'awaiting_review') {
      return { attempt: initial.attempt, requestId: initial.id, status: initial.status };
    }

    const claimed = await service.claim(initial.id, {
      attempt: initial.attempt,
      leaseMs: this.leaseMs,
      workerId: this.workerId,
    });
    if (!claimed) {
      const current = (await service.findById(initial.id)) ?? initial;
      return {
        attempt: current.attempt,
        reason:
          current.status === 'cancel_requested' ? DOCUMENT_REWRITE_WORKER_CANCELED : 'not-claimed',
        requestId: initial.id,
        status: isTerminalStatus(current.status) ? current.status : 'ignored',
      };
    }

    const lease = createLeaseGuard(
      service,
      claimed.id,
      claimed.attempt,
      this.workerId,
      this.leaseMs,
      this.logger,
    );
    const abortController = new AbortController();
    let cancelPoller: ReturnType<typeof setInterval> | undefined;
    let editor: CollaborativeAgentEditorSession | undefined;
    let result: DocumentRewriteWorkerResult | undefined;
    let current: DocumentRewriteRequestItem | undefined;
    let commandSubmitted = false;
    let directApplyVerificationFailed = false;
    let submittedCommand: RewriteCommandResult | undefined;
    let streamingSession: CollaborativeAgentStreamingRewriteSession | undefined;
    let streamingPump: StreamingChunkPump | undefined;
    let streamingSessionStarted = false;
    let streamFinalized = false;
    let streamAbortRequested = false;
    let streamGenerationId: string | undefined;
    let streamModel: string | null | undefined;
    let streamProvider: string | null | undefined;
    let streamExpectedFinalText: string | undefined;
    let streamCompletionEvidence = false;
    let streamMetadataAnnounced = false;
    let streamHandlerChain: Promise<void> = Promise.resolve();
    let latestGeneratorDiagnostics: RewriteGeneratorDiagnostics | undefined;
    let publicProgress = claimed.progress
      ? normalizeDocumentRewriteProgress(claimed.progress)
      : null;

    const emitProgress: RewriteGeneratorProgressHandler = async (next) => {
      if (!next || typeof next !== 'object') return;
      const previous = publicProgress?.events.at(-1);
      if (
        previous &&
        previous.stage === next.stage &&
        previous.detail === next.detail &&
        previous.summary === next.summary &&
        previous.tool === next.tool &&
        publicProgress?.currentStage === next.stage
      ) {
        return;
      }

      const updatedAt = new Date().toISOString();
      const candidate = normalizeDocumentRewriteProgress({
        currentStage: next.stage,
        events: [
          ...(publicProgress?.events ?? []),
          {
            at: updatedAt,
            ...(next.detail ? { detail: next.detail } : {}),
            stage: next.stage,
            ...(next.summary ? { summary: next.summary } : {}),
            ...(next.tool ? { tool: next.tool } : {}),
          },
        ],
        ...(next.summary || publicProgress?.summary
          ? { summary: next.summary ?? publicProgress?.summary }
          : {}),
        updatedAt,
      });
      if (!candidate) return;
      publicProgress = candidate;

      try {
        await service.updateProgress?.(claimed.id, {
          attempt: claimed.attempt,
          progress: candidate,
          workerId: this.workerId,
        });
      } catch (error) {
        // Progress is advisory. A transient DB/lease race must not turn a
        // valid model generation into a document failure, and no raw model
        // event is ever retained as a fallback.
        this.logger.warn(`Document rewrite progress update failed: ${asMessage(error)}`);
      }
    };

    const recoverPersistedDirectWrite = async (): Promise<
      DocumentRewriteRequestItem | undefined
    > => {
      // A request-linked history row is emitted for every room snapshot,
      // including partial streaming output. Only a request that already has
      // its final output payload persisted can be recovered as applied; a
      // null output is an interrupted/incomplete write and must remain
      // fail-closed for the normal stale/recovery path.
      if (
        initial.status !== 'writing' ||
        !initial.lastCommandId ||
        typeof initial.outputText !== 'string' ||
        !service.markDirectApplied
      ) {
        return undefined;
      }
      if (initial.selection.targetKind === 'node') {
        const adapterId = initial.selection.adapterId;
        const nodeId = initial.selection.targetNodeId;
        if (!adapterId || !nodeId) {
          throw new DocumentRewriteGenerationConflictError(
            'Recovered rewrite node target is missing adapterId or targetNodeId',
          );
        }
        const recoveredTarget = editor?.resolveBlockRewriteTarget?.({ adapterId, nodeId });
        // The request row stores the generated source for source adapters. A
        // patch adapter stores its patch envelope until the first worker has
        // re-read the materialized source; recovery can still verify the
        // adapter's source/hash contract before settling that row.
        const recoveredExpectedSource =
          adapterId === 'link-block-card' || typeof initial.outputText !== 'string'
            ? undefined
            : { kind: 'source' as const, source: initial.outputText };
        assertAppliedAdapterNodeSource(recoveredTarget, recoveredExpectedSource);
      }
      const recovered = await service.markDirectApplied(claimed.id, {
        attempt: claimed.attempt,
        commandId: initial.lastCommandId,
        generationId: initial.generationId,
        model: initial.model,
        outputText: initial.outputText,
        provider: initial.provider,
        workerId: this.workerId,
      });
      return recovered?.request;
    };

    const startCancellationPolling = (): void => {
      if (cancelPoller) return;
      cancelPoller = setInterval(() => {
        void this.cancellation(service, claimed.id, claimed.attempt)
          .then((request) => {
            if (request && request.status === 'cancel_requested') abortController.abort();
          })
          .catch((error: unknown) => {
            this.logger.warn(`Document rewrite cancellation poll failed: ${asMessage(error)}`);
          });
      }, this.cancellationPollMs);
      (cancelPoller as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
    };

    const beginStreamingSession = async (
      metadata: RewriteGeneratorStreamMetadata = {},
    ): Promise<void> => {
      if (streamingSession) return;
      if (!editor) {
        throw new DocumentRewriteWorkerError(
          'Collaborative Agent editor is unavailable for streaming',
          DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED,
          false,
        );
      }
      const start = getStreamingRewriteStart(editor);
      if (!start) {
        throw new DocumentRewriteWorkerError(
          'Collaborative Agent editor does not support streaming rewrites',
          DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED,
          false,
        );
      }

      // A long model generation may outlive the lease-bound room ticket. The
      // provider can reconnect with a freshly issued ticket in that window;
      // wait for its bounded sync barrier before resolving/applying the target.
      await lease.assert();
      await waitForSyncWithAbort(editor, abortController.signal, this.syncTimeoutMs);
      await lease.assert();
      current = await service.findById(claimed.id);
      if (!current || current.attempt !== claimed.attempt) {
        throw new DocumentRewriteLeaseLostError('Rewrite request changed before streaming');
      }
      if (isCancellationStatus(current.status)) throw new DocumentRewriteCanceledError();

      const selectionResolution = resolveRewriteSelectionWithSource(
        editor,
        claimed.selection as unknown as RewriteSelection,
        claimed.sessionId,
      );
      const resolved = selectionResolution.resolved;
      if (!resolved) {
        // RelativePosition resolution can fail both when a target was deleted
        // and when a human changed its contents. Use the read-only durable
        // identity proof when the Editor exposes it; only a missing target is
        // an explicit cancellation. Existing targets with a stale range must
        // fail as stale so the request is never incorrectly canceled.
        const inspection = await inspectRewriteTargets(
          editor,
          claimed.selection.targetNodeIds ?? claimed.targetNodeIds ?? [],
        );
        if (inspection?.missingNodeIds.length) throw new DocumentRewriteRegionMissingError();
        throw new DocumentRewriteStaleError('Rewrite selection changed before streaming');
      }
      if (!selectionHashMatches(claimed.selection, resolved)) {
        throw new DocumentRewriteStaleError('Rewrite selection changed before streaming');
      }
      const rebasedStreamSelection = selectionResolution.rebased
        ? resolvedSelectionPayload(resolved)
        : null;
      const streamSelection: DocumentRewriteSelection = rebasedStreamSelection
        ? (rebasedStreamSelection as unknown as DocumentRewriteSelection)
        : claimed.selection;
      if (!streamSelection) {
        throw new DocumentRewriteStaleError('Rewrite selection has no durable block offsets');
      }
      streamGenerationId =
        metadata.generationId?.trim() ||
        streamGenerationId ||
        `${claimed.id}:generation:${claimed.attempt}`;
      streamModel = metadata.model?.trim() || streamModel || claimed.model || null;
      streamProvider = metadata.provider?.trim() || streamProvider || claimed.provider || null;
      const commandId = `${claimed.id}:attempt:${claimed.attempt}`;

      await this.transition(service, claimed.id, {
        attempt: claimed.attempt,
        generationId: streamGenerationId,
        lastCommandId: commandId,
        model: streamModel,
        provider: streamProvider,
        status: 'writing',
        workerId: this.workerId,
      });
      trySetAwareness(
        editor,
        { ...claimed, generationId: streamGenerationId },
        'writing',
        claimed.selection,
        this.logger,
      );

      const sessionId = commandId;
      let started: Awaited<ReturnType<CollaborativeAgentStreamingRewriteStart>>;
      try {
        started = await start({
          expectedTextHash: hashRewriteText(resolved.quotedText),
          generationId: streamGenerationId,
          model: streamModel ?? undefined,
          provider: streamProvider ?? undefined,
          requestId: claimed.id,
          selection: streamSelection,
          sessionId,
          provenanceSessionId: claimed.sessionId || claimed.id,
          turnIndex: claimed.turnIndex || 1,
        });
      } catch (error) {
        // The Editor reports this when another stream currently owns the
        // block. No chunk has entered this session yet, so retry the request
        // through the durable backoff path instead of showing a conflict.
        if (isStreamSessionBusyError(error)) {
          throw new DocumentRewriteStreamingSessionBusyError(asMessage(error));
        }
        throw error;
      }
      const isSession = (value: unknown): value is CollaborativeAgentStreamingRewriteSession =>
        isRecord(value) &&
        typeof value.append === 'function' &&
        typeof value.finalize === 'function';
      const startedResult = isSession(started)
        ? undefined
        : (started as CollaborativeAgentStreamingRewriteResult | undefined);
      if (isStreamSessionBusyError(startedResult)) {
        throw new DocumentRewriteStreamingSessionBusyError(
          startedResult?.error || 'Rewrite streaming session is already active',
        );
      }
      streamingSessionStarted = true;
      if (startedResult?.status === 'conflict' || startedResult?.status === 'stopped') {
        const startError = startedResult.error || '';
        if (/region[_ -]?missing|target.+(?:deleted|missing)/i.test(startError)) {
          throw new DocumentRewriteRegionMissingError();
        }
        if (startedResult.status === 'stopped') {
          throw new DocumentRewriteStreamingTransportError(startError || 'Rewrite stream stopped');
        }
        throw new DocumentRewriteGenerationConflictError(startError || 'Rewrite stream conflicted');
      }
      if (!isSession(started) && startedResult?.status === 'failed') {
        throw new DocumentRewriteCommandFailedError(
          startedResult.error || 'Rewrite streaming session failed to start',
        );
      }
      const streamingMethods = editor as CollaborativeAgentEditorSession & {
        abortStreamingRewrite?: (input: { reason?: string; sessionId: string }) => unknown;
        appendStreamingRewrite?: (
          input: CollaborativeAgentStreamingRewriteChunk & { sessionId: string },
        ) => unknown;
        finalizeStreamingRewrite?: (input: { sessionId: string }) => unknown;
      };
      if (!isSession(started) && typeof streamingMethods.appendStreamingRewrite !== 'function') {
        throw new DocumentRewriteWorkerError(
          'Collaborative Agent editor has no streaming append method',
          DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED,
          false,
        );
      }
      if (!isSession(started) && typeof streamingMethods.finalizeStreamingRewrite !== 'function') {
        throw new DocumentRewriteWorkerError(
          'Collaborative Agent editor has no streaming finalize method',
          DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED,
          false,
        );
      }
      streamingSession = isSession(started)
        ? started
        : {
            append: (chunk) =>
              Promise.resolve(
                streamingMethods.appendStreamingRewrite!({
                  ...chunk,
                  sessionId,
                }) as RewriteCommandResult | Promise<RewriteCommandResult>,
              ),
            commandId: startedResult?.sessionId || sessionId,
            finalize: () =>
              Promise.resolve(
                streamingMethods.finalizeStreamingRewrite!({ sessionId }) as
                  RewriteCommandResult | Promise<RewriteCommandResult>,
              ),
            abort: async () => {
              await Promise.resolve(
                streamingMethods.abortStreamingRewrite?.({
                  reason: 'stream-aborted',
                  sessionId,
                }) as RewriteCommandResult | Promise<RewriteCommandResult> | undefined,
              );
            },
          };
      streamingPump = new StreamingChunkPump(
        streamingSession!.append,
        streamGenerationId,
        this.streamingGraphemePacingMs,
        this.streamingGraphemeBatchSize,
        (error) => {
          // Abort the provider as soon as an append reports conflict/target
          // deletion. This makes late model tokens no-ops even when its SSE
          // parser continues reading already-buffered frames.
          if (!abortController.signal.aborted) abortController.abort(error);
        },
      );
    };

    const processStreamChunk = async (rawChunk: RewriteGeneratorChunk | string): Promise<void> => {
      const chunk = asChunk(rawChunk);
      if (chunk.text.length === 0) return;
      if (!streamingSession) await beginStreamingSession();
      const active = await service.findById(claimed.id);
      if (!active || active.attempt !== claimed.attempt) {
        throw new DocumentRewriteLeaseLostError('Rewrite request changed during streaming');
      }
      if (isCancellationStatus(active.status)) {
        throw new DocumentRewriteCanceledError();
      }
      if (!streamingPump) {
        throw new DocumentRewriteWorkerError(
          'Collaborative Agent streaming pump is unavailable',
          DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED,
          false,
        );
      }
      // Mark the write boundary before awaiting the provider call. The room
      // may have accepted an update even if the transport reports an error;
      // recovery must never regenerate a second stream for the same command.
      commandSubmitted = true;
      await streamingPump.push(chunk);
    };

    const streamHandler = ((rawChunk: RewriteGeneratorChunk | string): Promise<void> => {
      // A provider/custom generator may synchronously fan out callbacks and
      // ignore their promises. Keep one explicit chain so chunks retain source
      // order and an append failure is observed by the finalizer.
      streamHandlerChain = streamHandlerChain.then(() => processStreamChunk(rawChunk));
      void streamHandlerChain.catch(() => undefined);
      return streamHandlerChain;
    }) as RewriteGeneratorChunkHandler;

    streamHandler.onStart = async (metadata) => {
      // Metadata alone must not move the request to `writing`; that state is
      // entered by the first chunk after the current selection is rechecked.
      streamGenerationId = metadata.generationId?.trim() || streamGenerationId;
      streamModel = metadata.model?.trim() || streamModel;
      streamProvider = metadata.provider?.trim() || streamProvider;
      streamMetadataAnnounced = true;
    };
    streamHandler.onProgress = emitProgress;

    const cleanupStreamingIdentity = async (
      sessionId: string,
      generationId?: string,
    ): Promise<void> => {
      if (!editor || streamAbortRequested) return;
      streamAbortRequested = true;
      try {
        const cleanupMethods = editor as CollaborativeAgentEditorSession & {
          cleanupStreamingRewrite?: (input: {
            generationId?: string;
            requestId: string;
            sessionId: string;
          }) => unknown;
          cleanupRewriteSession?: (input: {
            generationId?: string;
            requestId: string;
            sessionId: string;
          }) => unknown;
          recoverRewriteSession?: (input: {
            generationId?: string;
            requestId: string;
            sessionId: string;
          }) => unknown;
        };
        const recover = cleanupMethods.recoverRewriteSession;
        if (typeof recover === 'function') {
          await recover.call(editor, {
            generationId: generationId ?? streamGenerationId,
            requestId: claimed.id,
            sessionId,
          });
          return;
        }
        const cleanup =
          cleanupMethods.cleanupStreamingRewrite ?? cleanupMethods.cleanupRewriteSession;
        if (typeof cleanup === 'function') {
          await cleanup.call(editor, {
            generationId: generationId ?? streamGenerationId,
            requestId: claimed.id,
            sessionId,
          });
          return;
        }
        const abort = cleanupMethods.abortStreamingRewrite;
        if (typeof abort === 'function') {
          await abort.call(editor, { reason: 'stream-aborted', sessionId });
        } else {
          await streamingSession?.abort?.();
        }
      } catch (error) {
        this.logger.warn(`Document rewrite streaming abort failed: ${asMessage(error)}`);
      }
    };

    const abortStreamingSession = async (): Promise<void> => {
      if (!streamingSession) return;
      await cleanupStreamingIdentity(
        streamingSession.commandId ?? `${claimed.id}:attempt:${claimed.attempt}`,
        streamGenerationId,
      );
    };

    const finalizeStreamingSession = async (): Promise<RewriteCommandResult> => {
      if (!streamingSession || !streamingPump || !streamGenerationId) {
        throw new DocumentRewriteCommandFailedError('Rewrite streaming session was not started');
      }
      if (!streamCompletionEvidence) {
        throw new DocumentRewriteCommandFailedError(
          'Rewrite streaming generator did not return final output metadata',
        );
      }
      await streamingPump.flush();
      if (
        streamExpectedFinalText !== undefined &&
        streamingPump.text.trim() !== streamExpectedFinalText
      ) {
        throw new DocumentRewriteGenerationConflictError(
          'Rewrite stream final output does not match accepted chunks',
        );
      }
      const finalText = streamingPump.text.trim();
      const finalized = await streamingSession.finalize({
        attempt: claimed.attempt,
        generationId: streamGenerationId,
        model: streamModel,
        provider: streamProvider,
        replacementText: finalText,
        requestId: claimed.id,
      });
      const resolvedResult =
        (finalized as RewriteCommandResult | undefined) ?? editor?.getRewriteResult?.(claimed.id);
      const status = commandStatus(resolvedResult);
      const streamResultError =
        isRecord(resolvedResult) && typeof resolvedResult.error === 'string'
          ? resolvedResult.error
          : '';
      if (!resolvedResult || status === 'stale') {
        throw new DocumentRewriteStaleError('Rewrite streaming session reported a stale target');
      }
      if (status === 'conflict') {
        if (/region[_ -]?missing|target.+(?:deleted|missing)/i.test(streamResultError)) {
          throw new DocumentRewriteRegionMissingError();
        }
        throw new DocumentRewriteGenerationConflictError(
          streamResultError || 'Rewrite streaming target changed',
        );
      }
      if (status === 'stopped' || status === 'aborted') {
        throw new DocumentRewriteStreamingTransportError(
          streamResultError || 'Rewrite streaming session stopped',
        );
      }
      if (status === 'failed') {
        const error = streamResultError;
        if (/region[_ -]?missing/i.test(error)) {
          throw new DocumentRewriteRegionMissingError();
        }
        if (/generation[_ -]?mismatch|conflict/i.test(error)) {
          throw new DocumentRewriteGenerationConflictError();
        }
        throw new DocumentRewriteCommandFailedError(error || 'Rewrite streaming finalize failed');
      }
      if (status !== 'applied') {
        throw new DocumentRewriteCommandFailedError(
          'Rewrite streaming session did not return an applied result',
        );
      }
      streamFinalized = true;
      return {
        ...(resolvedResult as RewriteCommandResult),
        commandId:
          (resolvedResult as RewriteCommandResult).commandId ||
          streamingSession.commandId ||
          `${claimed.id}:attempt:${claimed.attempt}`,
      };
    };

    const settleFinalizedStreamingCommand = async (
      finalized: RewriteCommandResult,
    ): Promise<DocumentRewriteWorkerResult> => {
      commandSubmitted = true;
      submittedCommand = finalized;
      const commandStateVector = (finalized as unknown as { stateVector?: unknown }).stateVector;
      const stateVector =
        (typeof commandStateVector === 'string' ? commandStateVector : undefined) ??
        editor?.getStateVector?.();
      await emitProgress({ stage: 'syncing' });
      const appliedRequest = await this.waitForDirectApply(service, claimed, {
        commandId: finalized.commandId,
        generationId: streamGenerationId,
        model: streamModel ?? null,
        outputText: streamingPump?.text.trim() ?? '',
        provider: streamProvider ?? null,
        stateVector,
      });
      if (editor) trySetAwareness(editor, appliedRequest, 'done', claimed.selection, this.logger);
      return {
        attempt: claimed.attempt,
        commandId: finalized.commandId,
        requestId: claimed.id,
        ...(appliedRequest.errorCode === 'CANCELED_AFTER_WRITE'
          ? { reason: DOCUMENT_REWRITE_WORKER_CANCELED }
          : {}),
        status: 'applied',
      };
    };

    const settleStreamingCancellationIfRequested = async (): Promise<
      DocumentRewriteWorkerResult | undefined
    > => {
      const latest = await service.findById(claimed.id);
      if (!latest || latest.attempt !== claimed.attempt || latest.status !== 'cancel_requested') {
        return undefined;
      }
      if (streamingPump?.hasWritten && streamCompletionEvidence) {
        const finalized = await finalizeStreamingSession();
        return settleFinalizedStreamingCommand(finalized);
      }
      streamingPump?.fail(new DocumentRewriteCanceledError());
      await abortStreamingSession();
      return this.settleCancellation(service, latest, editor);
    };

    try {
      // A previous worker may have written the direct command but exited before
      // recording the durable request transition. Prove/settle that command
      // before minting another room ticket or asking the model to regenerate.
      const recovered = await recoverPersistedDirectWrite();
      if (recovered) {
        result = {
          attempt: recovered.attempt,
          commandId: recovered.lastCommandId ?? initial.lastCommandId ?? undefined,
          requestId: recovered.id,
          status: 'applied',
        };
        return result;
      }
      const roomId = claimed.selection.roomId;
      if (!roomId || typeof roomId !== 'string') {
        throw new DocumentRewriteStaleError('Rewrite request has no roomId');
      }

      // A cancellation can race the claim and arrive before ticket issuance.
      // Re-read the durable row first so a queued/claimed cancellation never
      // receives a room capability or opens a provider connection.
      current = await service.findById(claimed.id);
      if (!current || current.attempt !== claimed.attempt) {
        throw new DocumentRewriteLeaseLostError('Rewrite request attempt changed before connect');
      }
      if (isCancellationStatus(current.status)) {
        result = await this.settleCancellation(service, current, undefined);
        return result;
      }
      startCancellationPolling();

      const ticket = await service.issueRoomTicket(claimed.id, {
        attempt: claimed.attempt,
        roomId,
        workerId: this.workerId,
      });
      await lease.assert();
      const refreshTicket = () =>
        service.issueRoomTicket(claimed.id, {
          attempt: claimed.attempt,
          roomId,
          workerId: this.workerId,
        });
      const providerOptions: RefreshableProviderOptions = {
        refreshTicket,
        wsBaseUrl: resolveDocumentRewriteCollaborationWsUrl(this.collaborationWsUrl),
      };
      const editorOptions: CollaborativeAgentEditorConnectOptions = {
        documentId: claimed.documentId,
        requestId: claimed.id,
        providerOptions,
        roomId,
        ticket,
      };
      if (this.editorFactory.create) {
        // A test/deployment adapter may construct an unconnected session so
        // the local awareness state is visible while auth and initial sync are
        // pending. The stock public facade only exposes static connect and is
        // therefore handled by the branch below.
        editor = await awaitWithAbortAndTimeout(
          () => this.editorFactory.create!(editorOptions),
          abortController.signal,
          this.connectTimeoutMs,
          new DocumentRewriteSyncTimeoutError('Collaborative Agent editor creation timed out'),
          undefined,
          (lateEditor) => {
            void Promise.resolve()
              .then(() => lateEditor.disconnect())
              .catch(() => undefined);
          },
        );
        trySetAwareness(editor, claimed, 'connecting', claimed.selection, this.logger);
        if (editor.connect) {
          await awaitWithAbortAndTimeout(
            () => editor!.connect!(),
            abortController.signal,
            this.connectTimeoutMs,
            new DocumentRewriteSyncTimeoutError('Collaborative Agent editor connection timed out'),
            () => {
              void Promise.resolve()
                .then(() => editor!.disconnect())
                .catch(() => undefined);
            },
            () => {
              void Promise.resolve()
                .then(() => editor!.disconnect())
                .catch(() => undefined);
            },
          );
        }
      } else {
        if (!this.editorFactory.connect) {
          throw new DocumentRewriteWorkerError(
            'Collaborative Agent editor factory has no connect lifecycle',
            DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED,
            false,
          );
        }
        editor = await awaitWithAbortAndTimeout(
          () => this.editorFactory.connect!(editorOptions),
          abortController.signal,
          this.connectTimeoutMs,
          new DocumentRewriteSyncTimeoutError('Collaborative Agent editor connection timed out'),
          undefined,
          (lateEditor) => {
            void Promise.resolve()
              .then(() => lateEditor.disconnect())
              .catch(() => undefined);
          },
        );
        trySetAwareness(editor, claimed, 'connecting', claimed.selection, this.logger);
      }

      current = await service.findById(claimed.id);
      if (!current || current.attempt !== claimed.attempt) {
        throw new DocumentRewriteLeaseLostError('Rewrite request attempt changed during connect');
      }
      if (isCancellationStatus(current.status)) {
        result = await this.settleCancellation(service, current, editor);
        return result;
      }

      await this.transition(service, claimed.id, {
        attempt: claimed.attempt,
        status: 'syncing',
        workerId: this.workerId,
      });
      await emitProgress({ stage: 'syncing' });
      trySetAwareness(editor, claimed, 'syncing', claimed.selection, this.logger);
      await waitForSyncWithAbort(editor, abortController.signal, this.syncTimeoutMs);
      await lease.assert();

      const recoveredAfterSync = await recoverPersistedDirectWrite();
      if (recoveredAfterSync) {
        trySetAwareness(editor, recoveredAfterSync, 'done', claimed.selection, this.logger);
        result = {
          attempt: recoveredAfterSync.attempt,
          commandId: recoveredAfterSync.lastCommandId ?? initial.lastCommandId ?? undefined,
          requestId: recoveredAfterSync.id,
          status: 'applied',
        };
        return result;
      }

      // A previous process can die after an append but before it retains the
      // in-memory stream session. Clear only its durable generation marker,
      // preserving the partial text. Do not regenerate over that range: first
      // give the room persistence proof one last chance, then close the
      // orphaned attempt as stale so a protected region cannot live forever.
      if (initial.status === 'writing' && initial.lastCommandId) {
        await cleanupStreamingIdentity(initial.lastCommandId, initial.generationId ?? undefined);
        if (typeof initial.outputText !== 'string') {
          throw new DocumentRewriteStaleError(
            'Previous rewrite stream has no finalized output payload',
          );
        }
        if (claimed.selection.targetKind === 'node') {
          const adapterId = claimed.selection.adapterId;
          const nodeId = claimed.selection.targetNodeId;
          if (!adapterId || !nodeId) {
            throw new DocumentRewriteGenerationConflictError(
              'Recovered rewrite node target is missing adapterId or targetNodeId',
            );
          }
          const recoveredTarget = editor?.resolveBlockRewriteTarget?.({ adapterId, nodeId });
          const recoveredExpectedSource =
            adapterId === 'link-block-card' || typeof initial.outputText !== 'string'
              ? undefined
              : { kind: 'source' as const, source: initial.outputText };
          assertAppliedAdapterNodeSource(recoveredTarget, recoveredExpectedSource);
        }
        const recoveredAfterCleanup = await service.markDirectApplied?.(claimed.id, {
          attempt: claimed.attempt,
          commandId: initial.lastCommandId,
          generationId: initial.generationId,
          model: initial.model,
          outputText: initial.outputText,
          provider: initial.provider,
          workerId: this.workerId,
        });
        if (recoveredAfterCleanup) {
          trySetAwareness(
            editor,
            recoveredAfterCleanup.request,
            'done',
            claimed.selection,
            this.logger,
          );
          result = {
            attempt: recoveredAfterCleanup.request.attempt,
            commandId: recoveredAfterCleanup.request.lastCommandId ?? initial.lastCommandId,
            requestId: recoveredAfterCleanup.request.id,
            status: 'applied',
          };
          return result;
        }
        throw new DocumentRewriteStaleError(
          'Previous rewrite stream session was recovered without a durable apply proof',
        );
      }

      current = await service.findById(claimed.id);
      if (!current || current.attempt !== claimed.attempt) {
        throw new DocumentRewriteLeaseLostError('Rewrite request attempt changed during sync');
      }
      if (isCancellationStatus(current.status)) {
        result = await this.settleCancellation(service, current, editor);
        return result;
      }

      await this.transition(service, claimed.id, {
        attempt: claimed.attempt,
        status: 'thinking',
        workerId: this.workerId,
      });
      await emitProgress({ stage: 'analyzing_context' });
      trySetAwareness(editor, claimed, 'thinking', claimed.selection, this.logger);

      const isNodeTarget = claimed.selection.targetKind === 'node';
      let resolved: RewriteResolvedSelection | undefined;
      let blockTarget: CollaborativeAgentBlockRewriteTarget | undefined;
      let blockOutputSchema: RewriteBlockOutputSchema | undefined;
      await emitProgress({ stage: 'syncing' });
      if (isNodeTarget) {
        const adapterId = claimed.selection.adapterId;
        const nodeId = claimed.selection.targetNodeId;
        if (!adapterId || !nodeId || !claimed.selection.sourceHash) {
          throw new DocumentRewriteCommandFailedError(
            'Node rewrite target is missing adapterId, targetNodeId, or sourceHash',
          );
        }
        blockTarget =
          editor.resolveBlockRewriteTarget?.({
            adapterId,
            nodeId,
            sourceHash: claimed.selection.sourceHash,
          }) ?? undefined;
        if (!blockTarget) {
          const inspection = await inspectRewriteTargets(editor, [nodeId]);
          if (inspection?.missingNodeIds.includes(nodeId)) {
            throw new DocumentRewriteRegionMissingError();
          }
          throw new DocumentRewriteStaleError('Rewrite node target is unavailable');
        }
        if (blockTarget.adapterId !== adapterId || blockTarget.nodeId !== nodeId) {
          throw new DocumentRewriteGenerationConflictError('Rewrite node target identity changed');
        }
        if (!isRewriteBlockOutputSchema(blockTarget.outputSchema)) {
          throw new DocumentRewriteGenerationConflictError(
            'Rewrite node output schema is unavailable',
          );
        }
        blockOutputSchema = blockTarget.outputSchema;
        if (blockTarget.sourceHash !== claimed.selection.sourceHash) {
          throw new DocumentRewriteGenerationConflictError('Rewrite node source changed');
        }
        if (
          typeof blockTarget.source !== 'string' ||
          hashRewriteText(blockTarget.source) !== claimed.selection.sourceHash
        ) {
          throw new DocumentRewriteGenerationConflictError('Rewrite node source proof invalid');
        }
      } else {
        const textSelection = resolveRewriteSelection(
          editor,
          claimed.selection as unknown as RewriteSelection,
          claimed.sessionId,
        );
        if (!textSelection || !selectionHashMatches(claimed.selection, textSelection)) {
          throw new DocumentRewriteStaleError();
        }
        resolved = textSelection;
        editor.setSelection?.(textSelection.selection);
      }

      const requestGenerator = this.generatorFactory
        ? this.generatorFactory(
            Object.freeze({
              agentId: claimed.agentId,
              requestedByUserId: claimed.requestedByUserId,
              workspaceId: claimed.workspaceId ?? null,
            }),
          )
        : this.generator;
      if (!requestGenerator) {
        throw new DocumentRewriteWorkerError(
          'Document rewrite generator is not configured',
          DOCUMENT_REWRITE_WORKER_NOT_CONFIGURED,
          false,
        );
      }
      if (!claimed.topicId) {
        throw new DocumentRewriteWorkerError(
          'Document rewrite topic is required before model execution',
          DOCUMENT_REWRITE_WORKER_TOPIC_REQUIRED,
          false,
        );
      }
      const persistedSnapshot = await this.loadPersistedDocumentSnapshot(claimed);
      const verifiedBlockTarget =
        isNodeTarget &&
        blockTarget &&
        isRewriteBlockOutputSchema(blockOutputSchema) &&
        typeof blockTarget.source === 'string' &&
        typeof blockTarget.sourceHash === 'string'
          ? {
              ...blockTarget,
              outputSchema: blockOutputSchema,
              source: blockTarget.source,
              sourceHash: blockTarget.sourceHash,
            }
          : undefined;
      if (isNodeTarget && !verifiedBlockTarget) {
        throw new DocumentRewriteGenerationConflictError(
          'Rewrite node source proof invalid before topic turn',
        );
      }
      const topicTurn = await service.ensureTopicTurn?.({
        agentId: claimed.agentId,
        attempt: claimed.attempt,
        documentId: claimed.documentId,
        instruction: claimed.instruction,
        model: claimed.requestedModel ?? claimed.model,
        provider: claimed.requestedProvider ?? claimed.provider,
        requestId: claimed.id,
        operationId: claimed.operationId,
        sessionId: claimed.sessionId,
        status: claimed.status,
        ...(isNodeTarget && verifiedBlockTarget
          ? {
              targetContext: {
                adapterId: verifiedBlockTarget.adapterId,
                nodeId: verifiedBlockTarget.nodeId,
                nodeType: verifiedBlockTarget.nodeType,
                outputSchema: verifiedBlockTarget.outputSchema,
                ...(verifiedBlockTarget.language ? { language: verifiedBlockTarget.language } : {}),
                source: verifiedBlockTarget.source,
                sourceHash: verifiedBlockTarget.sourceHash,
                ...(verifiedBlockTarget.title ? { title: verifiedBlockTarget.title } : {}),
              } satisfies EnsureDocumentRewriteTargetContext,
            }
          : {}),
        topicId: claimed.topicId,
      });
      const pageContentContext: PageContentContext | undefined = persistedSnapshot
        ? {
            ...(persistedSnapshot.content ? { markdown: persistedSnapshot.content } : {}),
            metadata: {
              charCount: persistedSnapshot.content?.length,
              lineCount: persistedSnapshot.content?.split('\n').length,
              title: blockTarget?.title || persistedSnapshot.title || 'Untitled',
            },
          }
        : undefined;
      const modelQuotedText = isNodeTarget ? blockTarget?.source || '' : resolved?.quotedText || '';
      const modelStartNodeId = isNodeTarget ? blockTarget?.nodeId : resolved?.startNodeId;
      const modelEndNodeId = isNodeTarget ? blockTarget?.nodeId : resolved?.endNodeId;
      const modelTargetNodeIds = isNodeTarget
        ? [blockTarget?.nodeId || '']
        : (resolved?.targetNodeIds ??
          claimed.selection.targetNodeIds ??
          claimed.targetNodeIds ??
          []);
      const generatorInput = Object.freeze({
        adapterId: isNodeTarget ? claimed.selection.adapterId : undefined,
        agentId: claimed.agentId,
        attempt: claimed.attempt,
        documentId: claimed.documentId,
        endNodeId: modelEndNodeId,
        instruction: claimed.instruction,
        language: isNodeTarget ? blockTarget?.language : undefined,
        nodeType: isNodeTarget ? blockTarget?.nodeType : undefined,
        outputSchema: isNodeTarget ? blockOutputSchema : undefined,
        blockImage:
          isNodeTarget && blockTarget?.adapterId === 'block-image' ? blockTarget.image : undefined,
        model: claimed.requestedModel ?? claimed.model ?? undefined,
        requestedModel: claimed.requestedModel ?? claimed.model ?? undefined,
        provider: claimed.requestedProvider ?? claimed.provider ?? undefined,
        requestedProvider: claimed.requestedProvider ?? claimed.provider ?? undefined,
        quotedText: modelQuotedText,
        requestId: claimed.id,
        signal: abortController.signal,
        sessionId: claimed.sessionId || claimed.id,
        sourceHash: isNodeTarget ? claimed.selection.sourceHash : undefined,
        startNodeId: modelStartNodeId,
        targetKind: isNodeTarget ? 'node' : 'text-range',
        targetNodeId: isNodeTarget ? blockTarget?.nodeId : undefined,
        turnIndex: claimed.turnIndex || 1,
        targetNodeIds: Object.freeze([...modelTargetNodeIds]),
        onProgress: emitProgress,
        onDiagnostics: async (diagnostics) => {
          latestGeneratorDiagnostics = diagnostics;
          const outputLanguage = formatRewriteOutputLanguage(diagnostics.outputLanguage);
          await emitProgress({
            detail: formatRewriteGeneratorDiagnostics(diagnostics, {
              includeOutputLanguage: false,
            }),
            stage: 'generating_replacement',
            ...(outputLanguage ? { summary: `output_language=${outputLanguage}` } : {}),
          });
        },
        pageContentContext,
        topicId: claimed.topicId,
        ...(topicTurn
          ? {
              assistantMessageId: topicTurn.assistantMessageId,
              userMessageId: topicTurn.userMessageId,
            }
          : {}),
      } satisfies RewriteGeneratorInput);
      const streamingEditorStart = isNodeTarget ? undefined : getStreamingRewriteStart(editor);
      const streamingGenerator =
        typeof requestGenerator === 'function' ? undefined : requestGenerator.generateStream;
      if (streamingEditorStart) {
        // A stream-capable Editor is preferred even for a legacy generator: a
        // one-shot result is split into deterministic batches so the UI still
        // gets the same typewriter behavior while providers migrate.
        if (streamingGenerator) {
          const streamed = await invokeGeneratorStream(
            requestGenerator as RewriteGenerator,
            generatorInput,
            streamHandler,
          );
          const streamMetadata = normalizeStreamMetadata(streamed);
          streamExpectedFinalText = streamMetadata.replacementText?.trim();
          if (streamMetadata.replacementText === undefined) {
            throw new DocumentRewriteGeneratorInvalidError(
              'Rewrite streaming generator emitted no text output',
            );
          }
          // The stream is eligible for finalization only after the generator
          // returned its explicit complete replacement. A provider error or
          // truncated response after accepted chunks must remain recoverable,
          // never turn the visible prefix into an applied rewrite.
          streamCompletionEvidence = true;
          await streamHandlerChain;
          const canceledBeforeFinalize = await settleStreamingCancellationIfRequested();
          if (canceledBeforeFinalize) {
            result = canceledBeforeFinalize;
            return result;
          }
          if (
            streamMetadataAnnounced &&
            streamMetadata.generationId &&
            streamGenerationId &&
            streamMetadata.generationId !== streamGenerationId
          ) {
            throw new DocumentRewriteGenerationConflictError(
              'Rewrite streaming generation identity changed during generation',
            );
          }
          if (!streamingSession) {
            if (streamMetadata.generationId) streamGenerationId = streamMetadata.generationId;
            if (streamMetadata.model) streamModel = streamMetadata.model;
            if (streamMetadata.provider) streamProvider = streamMetadata.provider;
          }
          if (!streamingSession && streamMetadata.replacementText !== undefined) {
            const chunks = splitGeneratedText(streamMetadata.replacementText);
            for (const chunk of chunks) {
              await streamHandler({ text: chunk });
            }
            if (!streamingSession) await beginStreamingSession();
          } else if (!streamingSession && streamMetadata.replacementLiteXML !== undefined) {
            throw new DocumentRewriteGeneratorInvalidError(
              'LiteXML rewrite output cannot be streamed as text',
            );
          }
          if (streamMetadata.replacementLiteXML !== undefined) {
            throw new DocumentRewriteGeneratorInvalidError(
              'LiteXML rewrite output cannot be streamed as text',
            );
          }
          const streamedCommand = await finalizeStreamingSession();
          result = await settleFinalizedStreamingCommand(streamedCommand);
          return result;
        }

        await emitProgress({ stage: 'generating_replacement' });
        const generatedOneShot = normalizeOutput(
          await invokeGenerator(requestGenerator, generatorInput),
        );
        if (generatedOneShot.replacementLiteXML !== undefined) {
          throw new DocumentRewriteGeneratorInvalidError(
            'LiteXML rewrite output cannot be streamed as text',
          );
        }
        if (generatedOneShot.replacementBlock !== undefined) {
          throw new DocumentRewriteGeneratorInvalidError(
            'Block rewrite output cannot be streamed as text',
          );
        }
        if (generatedOneShot.replacementText === undefined) {
          throw new DocumentRewriteGeneratorInvalidError(
            'Rewrite streaming generator emitted no text output',
          );
        }
        streamExpectedFinalText = generatedOneShot.replacementText.trim();
        streamCompletionEvidence = true;
        streamGenerationId =
          generatedOneShot.generationId ?? `${claimed.id}:generation:${claimed.attempt}`;
        streamModel = generatedOneShot.model ?? claimed.model ?? null;
        streamProvider = generatedOneShot.provider ?? claimed.provider ?? null;
        for (const chunk of splitGeneratedText(generatedOneShot.replacementText)) {
          await streamHandler({ text: chunk });
        }
        // Empty replacement text remains a valid direct rewrite for the
        // legacy path. A stream session can represent it by finalizing after
        // opening without an append transaction.
        if (!streamingSession) await beginStreamingSession();
        if (!streamingPump) {
          throw new DocumentRewriteCommandFailedError('Rewrite streaming pump was not created');
        }
        const streamedCommand = await finalizeStreamingSession();
        result = await settleFinalizedStreamingCommand(streamedCommand);
        return result;
      }

      // Node targets never enter the text streaming session. A provider may
      // expose only `generateStream`, so buffer/discard its transport chunks
      // and consume the final block JSON through the same validation/apply
      // path. This prevents JSON framing from being inserted into a text
      // node while preserving stream-only provider compatibility.
      await emitProgress({ stage: 'generating_replacement' });
      const generated = normalizeOutput(
        isNodeTarget && streamingGenerator
          ? await invokeGeneratorStream(
              requestGenerator as RewriteGenerator,
              generatorInput,
              async () => undefined,
            )
          : await invokeGenerator(requestGenerator, generatorInput),
      );
      if (isNodeTarget && !generated.replacementBlock) {
        throw new DocumentRewriteGeneratorInvalidError(
          'Node rewrite generator must return replacementBlock output',
        );
      }
      if (isNodeTarget && generated.replacementBlock && blockTarget) {
        assertCompleteAdapterNodeOutput(
          blockTarget,
          generated.replacementBlock,
          latestGeneratorDiagnostics,
        );
      }
      if (!isNodeTarget && generated.replacementBlock) {
        throw new DocumentRewriteGeneratorInvalidError(
          'Text rewrite generator cannot return replacementBlock output',
        );
      }
      clearInterval(cancelPoller);
      cancelPoller = undefined;

      // Reconnect-capable Agent providers may have refreshed their room ticket
      // while the model was thinking. Do not resolve or dispatch against a
      // stale local room; wait for authenticated sync, then re-check the lease
      // and re-resolve the target below.
      await lease.assert();
      await waitForSyncWithAbort(editor, abortController.signal, this.syncTimeoutMs);
      await lease.assert();
      current = await service.findById(claimed.id);
      if (!current || current.attempt !== claimed.attempt) {
        throw new DocumentRewriteLeaseLostError('Rewrite request attempt changed before writing');
      }
      if (isCancellationStatus(current.status)) {
        result = await this.settleCancellation(service, current, editor);
        return result;
      }

      // Re-resolve after generation so human edits that entered the room while
      // the model was thinking cannot be applied to an old Lexical point.
      let currentResolved: RewriteResolvedSelection | undefined;
      let currentSelectionRebased = false;
      let currentBlockTarget: CollaborativeAgentBlockRewriteTarget | undefined;
      if (isNodeTarget) {
        const adapterId = claimed.selection.adapterId;
        const nodeId = claimed.selection.targetNodeId;
        if (!adapterId || !nodeId || !claimed.selection.sourceHash) {
          throw new DocumentRewriteCommandFailedError(
            'Node rewrite target is missing adapterId, targetNodeId, or sourceHash',
          );
        }
        currentBlockTarget =
          editor.resolveBlockRewriteTarget?.({
            adapterId,
            nodeId,
            sourceHash: claimed.selection.sourceHash,
          }) ?? undefined;
        if (!currentBlockTarget) {
          const inspection = await inspectRewriteTargets(editor, [nodeId]);
          if (inspection?.missingNodeIds.includes(nodeId)) {
            throw new DocumentRewriteRegionMissingError();
          }
          throw new DocumentRewriteStaleError('Rewrite node target changed while thinking');
        }
        if (
          currentBlockTarget.adapterId !== adapterId ||
          currentBlockTarget.nodeId !== nodeId ||
          currentBlockTarget.sourceHash !== claimed.selection.sourceHash
        ) {
          throw new DocumentRewriteGenerationConflictError(
            'Rewrite node source changed while thinking',
          );
        }
        if (
          !isRewriteBlockOutputSchema(currentBlockTarget.outputSchema) ||
          currentBlockTarget.outputSchema !== blockTarget?.outputSchema
        ) {
          throw new DocumentRewriteGenerationConflictError(
            'Rewrite node output schema changed while thinking',
          );
        }
        if (
          blockTarget?.language !== undefined &&
          currentBlockTarget.language !== blockTarget.language
        ) {
          throw new DocumentRewriteGenerationConflictError(
            'Rewrite node language changed while thinking',
          );
        }
        if (
          typeof currentBlockTarget.source !== 'string' ||
          hashRewriteText(currentBlockTarget.source) !== claimed.selection.sourceHash
        ) {
          throw new DocumentRewriteGenerationConflictError('Rewrite node source proof invalid');
        }
      } else {
        const currentSelectionResolution = resolveRewriteSelectionWithSource(
          editor,
          claimed.selection as unknown as RewriteSelection,
          claimed.sessionId,
        );
        currentResolved = currentSelectionResolution.resolved ?? undefined;
        currentSelectionRebased = currentSelectionResolution.rebased;
        if (!currentResolved || !selectionHashMatches(claimed.selection, currentResolved)) {
          throw new DocumentRewriteStaleError('Rewrite selection changed while model was thinking');
        }
        editor.setSelection?.(currentResolved.selection);
      }

      const generationId = generated.generationId ?? `${claimed.id}:attempt:${claimed.attempt}`;
      const commandId = `${claimed.id}:attempt:${claimed.attempt}`;
      const model = generated.model ?? claimed.model ?? null;
      const provider = generated.provider ?? claimed.provider ?? null;
      // Persist the deterministic command identity before dispatch. If the
      // worker exits after the room update but before the applied transition,
      // a recovery worker can prove/settle the same command without inventing
      // a second generation.
      await this.transition(service, claimed.id, {
        attempt: claimed.attempt,
        generationId,
        lastCommandId: commandId,
        model,
        outputText: generated.replacementBlock
          ? serializeRewriteBlockOutput(generated.replacementBlock)
          : (generated.replacementText ?? null),
        provider,
        status: 'writing',
        workerId: this.workerId,
      });
      trySetAwareness(editor, claimed, 'writing', claimed.selection, this.logger);

      // Cancellation may arrive after the writing transition but before the
      // direct command is dispatched. Re-check once more so that only a
      // command which has actually entered the room is treated as
      // non-rollbackable.
      current = await service.findById(claimed.id);
      if (!current || current.attempt !== claimed.attempt) {
        throw new DocumentRewriteLeaseLostError('Rewrite request changed before direct command');
      }
      if (isCancellationStatus(current.status)) {
        result = await this.settleCancellation(service, current, editor);
        return result;
      }

      // A process-local redelivery can observe the command result even if the
      // worker crashed between the Yjs command and its DB transition. Reuse
      // that result instead of stacking another direct update. A fresh process
      // still gets the deterministic command id and the room/editor preflight
      // gate.
      let settledCommandResult = editor.getRewriteResult?.(claimed.id);
      const existingCommandStatus = commandStatus(settledCommandResult);
      const currentSelectionPayload = isNodeTarget
        ? null
        : currentSelectionRebased
          ? resolvedSelectionPayload(currentResolved!)
          : (claimed.selection as unknown as BlockRewriteSelection | RewriteSelection);
      if (!isNodeTarget && !currentSelectionPayload) {
        throw new DocumentRewriteStaleError('Rewrite selection has no durable block offsets');
      }
      if (existingCommandStatus !== 'applied') {
        await emitProgress({ stage: 'applying' });
        const commandResult = isNodeTarget
          ? await editor.dispatchCommand(getApplyBlockRewriteCommand(this.blockRewriteCommand), {
              adapterKey: claimed.selection.adapterId,
              commandId,
              generationId,
              model: model ?? undefined,
              nodeId: currentBlockTarget?.nodeId || claimed.selection.targetNodeId,
              output: generated.replacementBlock,
              provenanceSessionId: claimed.sessionId || claimed.id,
              provider: provider ?? undefined,
              requestId: claimed.id,
              turnIndex: claimed.turnIndex || 1,
              // The source proof is checked again by the adapter command when
              // supported; keeping it in the payload lets newer editor builds
              // reject a human edit between resolve and dispatch.
              expectedSourceHash: currentBlockTarget?.sourceHash || claimed.selection.sourceHash,
            } as unknown)
          : await editor.dispatchCommand(LITEXML_REWRITE_RANGE_COMMAND, {
              ...(generated.replacementText === undefined
                ? { replacementLiteXML: generated.replacementLiteXML }
                : { replacementText: generated.replacementText }),
              attempt: claimed.attempt,
              commandId,
              // Use the canonical hash of the freshly resolved range. The
              // captured hash has already been checked above, but older browser
              // bundles may have hashed a raw cross-block newline representation.
              // The command validator and the RelativeSelection proof both use
              // this canonical value at the mutation boundary.
              expectedTextHash: hashRewriteText(currentResolved!.quotedText),
              generationId,
              model: model ?? undefined,
              mode: 'direct',
              provenanceSessionId: claimed.sessionId || claimed.id,
              sessionId: claimed.sessionId || claimed.id,
              turnIndex: claimed.turnIndex || 1,
              provider: provider ?? undefined,
              requestId: claimed.id,
              // Re-encode the freshly resolved range as a durable block
              // selection. This is also the continuation rebase path: when a
              // Markdown rewrite replaced the original Paragraph with a List,
              // the old RelativePosition no longer exists.
              selection: currentSelectionPayload!,
            });
        settledCommandResult = commandResult ?? editor.getRewriteResult?.(claimed.id);
      }
      const status = commandStatus(settledCommandResult);
      if (!settledCommandResult || status === 'stale') {
        throw new DocumentRewriteStaleError('Rewrite command reported a stale selection');
      }
      if (status === 'failed') {
        throw new DocumentRewriteCommandFailedError(
          settledCommandResult.error || 'Rewrite command failed',
        );
      }
      if (status !== 'applied' && !(isNodeTarget && status === 'diff-created')) {
        throw new DocumentRewriteCommandFailedError(
          'Direct rewrite command did not return an applied result',
        );
      }
      if (typeof settledCommandResult.commandId !== 'string' || !settledCommandResult.commandId) {
        throw new DocumentRewriteCommandFailedError('Rewrite command did not return a command id');
      }
      commandSubmitted = true;
      submittedCommand = settledCommandResult;

      if (isNodeTarget) {
        // `diff-created` from the block command only proves that the local
        // adapter mutation ran. Wait for the v1 provider acknowledgement
        // before the persistence barrier and eventual disconnect; the room
        // broadcasts to browser peers before emitting that acknowledgement.
        await editor.waitForUpdateAck?.(this.directPersistenceTimeoutMs);
      }

      const commandStateVector = (settledCommandResult as unknown as { stateVector?: unknown })
        .stateVector;
      const stateVector =
        (typeof commandStateVector === 'string' ? commandStateVector : undefined) ??
        editor.getStateVector?.();
      let directOutputText = generated.replacementBlock
        ? serializeRewriteBlockOutput(generated.replacementBlock)
        : (generated.replacementText ?? null);
      if (isNodeTarget && generated.replacementBlock) {
        try {
          const appliedBlockTarget = editor.resolveBlockRewriteTarget?.({
            adapterId: claimed.selection.adapterId!,
            nodeId: claimed.selection.targetNodeId!,
          });
          // Re-read after the room acknowledgement. A `diff-created` command
          // result is not enough to claim success: the adapter projection must
          // contain the generated source (or a materialized, self-consistent
          // source for patch adapters).
          directOutputText = assertAppliedAdapterNodeSource(
            appliedBlockTarget,
            generated.replacementBlock,
            currentBlockTarget?.language,
            currentBlockTarget?.title,
          );
        } catch (error) {
          directApplyVerificationFailed = true;
          throw error;
        }
      }
      const appliedRequest = await this.waitForDirectApply(service, claimed, {
        commandId: settledCommandResult.commandId,
        generationId,
        model,
        outputText: directOutputText,
        provider,
        stateVector,
      });
      trySetAwareness(editor, appliedRequest, 'done', claimed.selection, this.logger);
      result = {
        attempt: claimed.attempt,
        commandId: settledCommandResult.commandId,
        requestId: claimed.id,
        ...(appliedRequest.errorCode === 'CANCELED_AFTER_WRITE'
          ? { reason: DOCUMENT_REWRITE_WORKER_CANCELED }
          : {}),
        status: 'applied',
      };
      return result;
    } catch (error) {
      // Normalize protected-region responses from the Editor before deciding
      // whether a retry is safe. Once streaming has started, these are
      // terminal request outcomes and later model tokens must be discarded.
      const rawStreamError = error instanceof Error ? error.message : String(error);
      const streamBoundaryError =
        error instanceof DocumentRewriteRegionMissingError ||
        error instanceof DocumentRewriteGenerationConflictError ||
        error instanceof DocumentRewriteStaleError
          ? error
          : /region[_ -]?missing/i.test(rawStreamError)
            ? new DocumentRewriteRegionMissingError()
            : /generation[_ -]?mismatch|conflict/i.test(rawStreamError)
              ? new DocumentRewriteGenerationConflictError()
              : /rewrite-selection|stream-generation|stream-session-conflict|stream-caret/i.test(
                    rawStreamError,
                  )
                ? new DocumentRewriteGenerationConflictError()
                : undefined;

      if (streamBoundaryError && (streamingSessionStarted || streamGenerationId !== undefined)) {
        streamingPump?.fail(streamBoundaryError);
        const boundaryResult = await this.processFailure(service, claimed, streamBoundaryError);
        editor?.clearAwareness?.();
        return boundaryResult;
      }

      // If the model ended after an accepted append, commit the text already
      // in the room and wait for its durable history proof. A provider error
      // is not permission to roll back or regenerate the same command.
      if (streamingSessionStarted && streamingSession && streamingPump) {
        if (streamingPump.hasWritten && streamCompletionEvidence) {
          try {
            const finalized = await finalizeStreamingSession();
            result = await settleFinalizedStreamingCommand(finalized);
            return result;
          } catch (finalizeError) {
            this.logger.error(
              `Document rewrite streaming finalize failed request=${claimed.id}: ${asMessage(finalizeError)}`,
            );
            // Keep the request recoverable as the same command; never fall
            // through to model retry after a room write.
          }
        } else if (streamingPump.hasWritten) {
          // A provider ended without an explicit complete output. Preserve the
          // accepted prefix in the room, abort the temporary generation marker,
          // and fail this attempt terminally. It is not an applied rewrite;
          // retrying would regenerate against a room that already contains a
          // partial command and could duplicate the visible prefix.
          const incompleteStream = new DocumentRewriteGeneratorInvalidError(
            'Rewrite streaming generator ended before final output metadata',
          );
          streamingPump.fail(incompleteStream);
          await abortStreamingSession();
          result = await this.processFailure(service, claimed, incompleteStream);
          return result;
        } else {
          // No accepted text exists, but an append call may still have
          // reached the relay and failed ambiguously. Stop the session and
          // defer recovery under the same command identity rather than retry.
          streamingPump.fail(error);
          await abortStreamingSession();
        }
      }

      // Once a direct command has entered the room, never route a later
      // persistence-proof failure through model retry. Retrying would create a
      // second direct update while the first one may still be durable. Leave
      // the active row for recovery to prove/settle.
      if (commandSubmitted && submittedCommand && !directApplyVerificationFailed) {
        const currentAfterCommand = (await service.findById(claimed.id)) ?? claimed;
        if (currentAfterCommand.status === 'applied') {
          trySetAwareness(editor!, currentAfterCommand, 'done', claimed.selection, this.logger);
          result = {
            attempt: claimed.attempt,
            commandId: submittedCommand.commandId,
            requestId: claimed.id,
            status: 'applied',
          };
          return result;
        }
        result = {
          attempt: claimed.attempt,
          commandId: submittedCommand.commandId,
          reason: DOCUMENT_REWRITE_WORKER_LEASE_LOST,
          requestId: claimed.id,
          status: 'deferred',
        };
        return result;
      }
      if (streamingPump?.hasAttemptedWrite && streamingSessionStarted) {
        result = {
          attempt: claimed.attempt,
          commandId: streamingSession?.commandId ?? `${claimed.id}:attempt:${claimed.attempt}`,
          reason: DOCUMENT_REWRITE_WORKER_LEASE_LOST,
          requestId: claimed.id,
          status: 'deferred',
        };
        return result;
      }
      if (abortController.signal.aborted) {
        const current = (await service.findById(claimed.id)) ?? claimed;
        if (current.status === 'cancel_requested' && !lease.lost()) {
          result = await this.settleCancellation(service, current, editor);
          editor?.clearAwareness?.();
          return result;
        }
      }
      this.logger.error(
        `Document rewrite worker failed request=${claimed.id}: ${asMessage(error)}`,
      );
      result = await this.processFailure(service, claimed, error);
      if (editor) {
        trySetAwareness(
          editor,
          claimed,
          result.status === 'stale' || result.status === 'failed' ? 'error' : 'done',
          claimed.selection,
          this.logger,
        );
        if (
          result.status === 'canceled' ||
          result.status === 'canceled_after_write' ||
          result.status === 'stale' ||
          result.status === 'failed'
        ) {
          editor.clearAwareness?.();
        }
      }
      return result;
    } finally {
      if (cancelPoller) clearInterval(cancelPoller);
      lease.stop();
      if (editor) {
        try {
          // A crashed/failed local stream may have left only a temporary
          // generation-region marker in Yjs. Abort clears that marker while
          // retaining already inserted text; it never restores the original
          // selection. A finalized session is already terminal and must not
          // be touched while waiting for durable history proof.
          if (streamingSessionStarted && !streamFinalized) {
            await abortStreamingSession();
          }
          await editor.disconnect();
        } catch (error) {
          this.logger.warn(`Document rewrite editor disconnect failed: ${asMessage(error)}`);
        }
      }
    }
  };

  handle = this.process;
  run = this.process;

  enqueue = async (requestId: string, attempt: number, delayMs = 0): Promise<string> => {
    if (!this.queue) throw new Error('DocumentRewriteWorker queue is not configured');
    return this.queue.enqueue(createDocumentRewriteQueueMessage(requestId, attempt), { delayMs });
  };

  /**
   * Rebuild in-memory/remote deliveries from durable runnable rows. Call this
   * once on process boot; it is safe to call repeatedly because queue adapters
   * and request claims provide idempotency.
   */
  recoverRunnable = async (limit = 50): Promise<{ enqueued: number; processed: number }> => {
    await this.sweepPendingReviews();
    const recoveryLimit = normalizeRecoveryLimit(limit);
    let rows: DocumentRewriteRequestItem[];
    if (this.requestService?.listRunnable) {
      rows = await this.requestService.listRunnable(recoveryLimit);
    } else if (this.db) {
      const now = new Date();
      rows = await this.db
        .select()
        .from(documentRewriteRequests)
        .where(andRunnableRows(now))
        .orderBy(documentRewriteRequests.createdAt)
        .limit(recoveryLimit);
    } else {
      rows = [];
    }

    let enqueued = 0;
    let processed = 0;
    for (const row of rows) {
      const service = this.serviceFor(row);
      let runnable = row;
      if (runnable.status === 'retry_wait' && service.promoteRetry) {
        runnable = (await service.promoteRetry(runnable.id, runnable.attempt)) ?? runnable;
      }
      if (this.queue) {
        await this.queue.enqueue(createDocumentRewriteQueueMessage(runnable.id, runnable.attempt));
        enqueued += 1;
      } else {
        await this.process(createDocumentRewriteQueueMessage(runnable.id, runnable.attempt));
        processed += 1;
      }
    }
    return { enqueued, processed };
  };
}

const andRunnableRows = (currentTime: Date) =>
  or(
    eq(documentRewriteRequests.status, 'queued'),
    and(
      eq(documentRewriteRequests.status, 'retry_wait'),
      or(
        isNull(documentRewriteRequests.nextAttemptAt),
        lte(documentRewriteRequests.nextAttemptAt, currentTime),
      ),
    ),
    and(
      inArray(documentRewriteRequests.status, DOCUMENT_REWRITE_ACTIVE_CLAIM_STATUSES),
      or(
        isNull(documentRewriteRequests.leaseExpiresAt),
        lte(documentRewriteRequests.leaseExpiresAt, currentTime),
      ),
    ),
  );

export const createDocumentRewriteWorker = (
  options: DocumentRewriteWorkerOptions,
): DocumentRewriteWorker => new DocumentRewriteWorker(options);

export type DocumentRewriteWorkerMessage = DocumentRewriteQueueMessage;
