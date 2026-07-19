import type {
  AgentInterventionRequestData,
  AgentInterventionResponseData,
  AgentStreamEvent,
} from '@lobechat/agent-gateway-client';
import {
  AMP_CLI_INSTALL_DOCS_URL,
  CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
  CODEX_CLI_INSTALL_DOCS_URL,
  type HeterogeneousAgentSessionError,
  HeterogeneousAgentSessionErrorCode,
} from '@lobechat/electron-client-ipc';
import {
  createMainAgentRunState,
  type MainAgentIntent,
  type MainAgentReduceCtx,
  type MainAgentRunState,
  reduceMainAgent,
  rehydrateSubagentRunsState,
  type SubagentIntent,
  type SubagentRunSnapshot,
} from '@lobechat/heterogeneous-agents';
import { formatContextSelections, formatPageSelections } from '@lobechat/prompts';
import type {
  ChatMessageError,
  ChatToolPayload,
  ChatTopicMetadata,
  ChatTopicStatus,
  ContextSelection,
  ConversationContext,
  HeterogeneousProviderConfig,
  MessageMapScope,
  ModelUsage,
  PageSelection,
  UIChatMessage,
  WorkingDirConfig,
} from '@lobechat/types';
import {
  AgentRuntimeErrorType,
  buildHeteroSpawnArgs,
  ThreadStatus,
  ThreadType,
} from '@lobechat/types';
import { createNanoId } from '@lobechat/utils';
import { t } from 'i18next';

import { message as antdMessage } from '@/components/AntdStaticMethods';
import {
  removeHeteroSessionIdForWorkingDirectory,
  setHeteroSessionIdForWorkingDirectory,
} from '@/helpers/heteroSessionByWorkingDirectory';
import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import {
  type MessageBatchOperation,
  type MessageQueryContext,
  messageService,
} from '@/services/message';
import { threadService } from '@/services/thread';
import { topicSelectors } from '@/store/chat/selectors';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import {
  mergeQueuedMessages,
  reconstructUploadFilesFromQueue,
  type StreamRetryMetadata,
} from '@/store/chat/slices/operation/types';
import { type ChatStore, useChatStore } from '@/store/chat/store';
import { notifyDesktopHumanApprovalRequired } from '@/store/chat/utils/desktopNotification';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { buildRunLifecycle } from '../../lifecycle/buildRunLifecycle';
import type { RunScope } from '../../lifecycle/types';
import { createGatewayEventHandler, isCompletedRuntimeEnd } from '../gateway/gatewayEventHandler';
import { createMessageWriteBatcher, type ToolMessageUpdateOperation } from './messageWriteBatcher';
import { createPendingCreateLedger } from './pendingCreateLedger';
import { buildLobeHubSessionEnv } from './sessionEnv';

/** Mirrors `idGenerator('threads', 16)` on the server so sync-allocated ids have the same shape. */
const generateThreadId = () => `thd_${createNanoId(16)()}`;

const markSkipMessageFetch = (event: AgentStreamEvent): void => {
  event.data = { ...event.data, skipMessageFetch: true };
};

const CLI_AUTH_REQUIRED_PATTERNS = [
  /failed to authenticate/i,
  /invalid authentication credentials/i,
  /authentication[_ ]error/i,
  /not authenticated/i,
  /\bunauthorized\b/i,
  /\b401\b/,
] as const;
const AMP_AUTH_REQUIRED_PATTERNS = [/please (?:log|sign) in/i, /amp_api_key/i] as const;

const buildCliAuthRequiredSessionError = (
  agentType: 'amp' | 'claude-code' | 'codex',
  rawMessage: string,
): HeterogeneousAgentSessionError => {
  switch (agentType) {
    case 'amp': {
      return {
        agentType,
        code: HeterogeneousAgentSessionErrorCode.AuthRequired,
        docsUrl: AMP_CLI_INSTALL_DOCS_URL,
        message:
          'Amp could not authenticate. Run `amp login` or configure AMP_API_KEY, then retry.',
        stderr: rawMessage,
      };
    }
    case 'claude-code': {
      return {
        agentType,
        code: HeterogeneousAgentSessionErrorCode.AuthRequired,
        docsUrl: CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
        message:
          'Claude Code could not authenticate. Sign in again or refresh its credentials, then retry.',
        stderr: rawMessage,
      };
    }
    case 'codex': {
      return {
        agentType,
        code: HeterogeneousAgentSessionErrorCode.AuthRequired,
        docsUrl: CODEX_CLI_INSTALL_DOCS_URL,
        message:
          'Codex could not authenticate. Sign in again or refresh its credentials, then retry.',
        stderr: rawMessage,
      };
    }
  }
};

const normalizeErrorText = (value?: string) => value?.replaceAll(/\s+/g, ' ').trim();

const maybeClassifyCliAuthRequiredError = (
  error: unknown,
  agentType?: string,
): HeterogeneousAgentSessionError | undefined => {
  if (agentType !== 'amp' && agentType !== 'claude-code' && agentType !== 'codex') return;

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof error === 'object' &&
            error &&
            'message' in error &&
            typeof error.message === 'string'
          ? error.message
          : undefined;

  if (!message) return;
  const patterns =
    agentType === 'amp'
      ? [...CLI_AUTH_REQUIRED_PATTERNS, ...AMP_AUTH_REQUIRED_PATTERNS]
      : CLI_AUTH_REQUIRED_PATTERNS;
  if (!patterns.some((pattern) => pattern.test(message))) return;

  return buildCliAuthRequiredSessionError(agentType, message);
};

const shouldSuppressTerminalErrorEcho = (content: string, error: ChatMessageError): boolean => {
  const errorBody = error.body as
    (HeterogeneousAgentSessionError & { clearEchoedContent?: boolean }) | undefined;
  if (
    !errorBody?.clearEchoedContent &&
    errorBody?.code !== HeterogeneousAgentSessionErrorCode.AuthRequired
  ) {
    return false;
  }

  const normalizedContent = normalizeErrorText(content);
  const normalizedRawError = normalizeErrorText(
    errorBody?.stderr || errorBody?.message || error.message,
  );

  return !!normalizedContent && !!normalizedRawError && normalizedContent === normalizedRawError;
};

const getDefaultHeterogeneousCommand = (agentType: string): string => {
  switch (agentType) {
    case 'amp': {
      return 'amp';
    }
    case 'codex': {
      return 'codex';
    }
    default: {
      return 'claude';
    }
  }
};

const toHeterogeneousAgentMessageError = (error: unknown, agentType?: string): ChatMessageError => {
  const authRequiredError = maybeClassifyCliAuthRequiredError(error, agentType);
  if (authRequiredError) {
    return {
      body: authRequiredError,
      message: authRequiredError.message,
      type: AgentRuntimeErrorType.AgentRuntimeError,
    };
  }

  if (
    typeof error === 'object' &&
    error &&
    'message' in error &&
    typeof error.message === 'string' &&
    ('agentType' in error || 'code' in error || 'docsUrl' in error || 'installCommands' in error)
  ) {
    return {
      body: error as HeterogeneousAgentSessionError,
      message: error.message,
      type: AgentRuntimeErrorType.AgentRuntimeError,
    };
  }

  // A plain `{message}` object (adapter wire data / IPC error envelope)
  // without the session-error marker keys above still carries the only
  // human-readable reason — don't flatten it to the generic fallback.
  const objectMessage =
    typeof error === 'object' && error && 'message' in error && typeof error.message === 'string'
      ? error.message
      : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : (objectMessage ?? 'Agent execution failed');

  // Surface the underlying `cause` (e.g. undici's `ENOTFOUND` / `ECONNREFUSED`
  // hidden under a generic `TypeError: fetch failed`). The desktop IPC layer
  // ferries `cause` across via an error envelope (see `~common/ipcError`).
  // Flatten any Error cause to a plain object — `ChatMessageError.body` is
  // persisted as DB JSONB, where a raw Error would serialize to `{}`.
  const rawCause = error instanceof Error ? error.cause : undefined;
  const cause =
    rawCause instanceof Error
      ? {
          code: (rawCause as { code?: unknown }).code,
          message: rawCause.message,
          name: rawCause.name,
        }
      : rawCause;

  return {
    body: cause === undefined || cause === null ? { message } : { cause, message },
    message,
    type: AgentRuntimeErrorType.AgentRuntimeError,
  };
};

const isRecoverableResumeError = (
  error: unknown,
): error is HeterogeneousAgentSessionError & {
  code:
    | typeof HeterogeneousAgentSessionErrorCode.ResumeCwdMismatch
    | typeof HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound;
} => {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;

  return (
    error.code === HeterogeneousAgentSessionErrorCode.ResumeCwdMismatch ||
    error.code === HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound
  );
};

export interface HeterogeneousAgentExecutorParams {
  assistantMessageId: string;
  context: ConversationContext;
  contextSelections?: ContextSelection[];
  heterogeneousProvider: HeterogeneousProviderConfig;
  /** Image attachments from user message — passed to Main for vision support */
  imageList?: Array<{ id: string; url: string }>;
  message: string;
  operationId: string;
  pageSelections?: PageSelection[];
  /** CC session ID from previous execution in this topic (for --resume) */
  resumeSessionId?: string;
  workingDirectory?: string;
  workingDirectoryConfig?: WorkingDirConfig;
}

const buildLocalHeterogeneousSystemContext = ({
  agentSystemContext,
  contextSelections,
  pageSelections,
  workingDirectory,
}: {
  agentSystemContext?: string;
  contextSelections?: ContextSelection[];
  pageSelections?: PageSelection[];
  workingDirectory?: string;
}): string | undefined => {
  const parts: string[] = [];

  if (agentSystemContext?.trim()) parts.push(agentSystemContext.trim());

  if (workingDirectory?.trim()) {
    parts.push(
      [
        '## Workspace',
        `You are running on the user's own machine. Your working directory is \`${workingDirectory.trim()}\`.`,
      ].join('\n'),
    );
  }

  const selectionContext =
    contextSelections && contextSelections.length > 0
      ? formatContextSelections(contextSelections)
      : pageSelections && pageSelections.length > 0
        ? formatPageSelections(pageSelections)
        : '';

  if (selectionContext) parts.push(selectionContext);

  return parts.length > 0 ? parts.join('\n\n') : undefined;
};

const getTopicMetadataById = (
  store: ChatStore,
  topicId: string | undefined,
): ChatTopicMetadata | undefined => {
  if (!topicId) return;

  for (const topicData of Object.values(store.topicDataMap ?? {})) {
    const topic = topicData?.items?.find((item) => item.id === topicId);
    if (topic) return topic.metadata;
  }
};

/**
 * Map heterogeneousProvider.command to adapter type key.
 */
const resolveAdapterType = (config: HeterogeneousProviderConfig): string => {
  if (config.type) return config.type;
  // Explicit adapterType in config takes priority
  if ((config as any).adapterType) return (config as any).adapterType;

  // Infer from command name
  const cmd = config.command || 'claude';
  if (cmd.includes('claude')) return 'claude-code';
  if (cmd.includes('codex')) return 'codex';
  if (cmd.includes('kimi')) return 'kimi-cli';

  return 'claude-code'; // default
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const pickString = (...values: unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === 'string' && value.length > 0);

const pickFiniteNumber = (...values: unknown[]): number | undefined =>
  values.find((value): value is number => typeof value === 'number' && Number.isFinite(value));

const toStreamRetryMetadata = (
  event: AgentStreamEvent,
  fallbackAgentType: string,
): StreamRetryMetadata => {
  const data = asRecord(event.data);

  return {
    agentType: pickString(data.agentType, fallbackAgentType),
    attempt: pickFiniteNumber(data.attempt),
    delayMs: pickFiniteNumber(data.delayMs),
    error: pickString(data.error, data.errorType, data.kind, data.message),
    errorStatus: pickFiniteNumber(data.errorStatus, data.status, data.statusCode, data.httpStatus),
    maxAttempts: pickFiniteNumber(data.maxAttempts),
    provider: pickString(data.provider),
  };
};

/**
 * Subscribe to Electron IPC broadcasts. As of phase 0, the main
 * process runs JSONL framing + adapter conversion + `toStreamEvent` itself
 * (`AgentStreamPipeline` from `@lobechat/heterogeneous-agents/spawn`), so the
 * renderer receives ready-made `AgentStreamEvent`s with no per-event adapter
 * step. Returns unsubscribe function.
 */
const subscribeBroadcasts = (
  sessionId: string,
  callbacks: {
    onComplete: () => void;
    onError: (error: HeterogeneousAgentSessionError | string) => void;
    onStreamEvent: (event: AgentStreamEvent) => void;
  },
): (() => void) => {
  if (!window.electron?.ipcRenderer) return () => {};

  const ipc = window.electron.ipcRenderer;

  const onStreamEvent = (_e: any, data: { event: AgentStreamEvent; sessionId: string }) => {
    if (data.sessionId === sessionId) callbacks.onStreamEvent(data.event);
  };
  const onComplete = (_e: any, data: { sessionId: string }) => {
    if (data.sessionId === sessionId) callbacks.onComplete();
  };
  const onError = (
    _e: any,
    data: { error: HeterogeneousAgentSessionError | string; sessionId: string },
  ) => {
    if (data.sessionId === sessionId) callbacks.onError(data.error);
  };

  ipc.on('heteroAgentEvent' as any, onStreamEvent);
  ipc.on('heteroAgentSessionComplete' as any, onComplete);
  ipc.on('heteroAgentSessionError' as any, onError);

  return () => {
    ipc.removeListener('heteroAgentEvent' as any, onStreamEvent);
    ipc.removeListener('heteroAgentSessionComplete' as any, onComplete);
    ipc.removeListener('heteroAgentSessionError' as any, onError);
  };
};

/**
 * Thread-scoped in-memory dispatcher for a single subagent run. The
 * caller binds it to a per-spawn sub-operation whose
 * `OperationContext.threadId` + `scope: 'thread'` cause
 * `internal_dispatchMessage` to route every create/update into the
 * Thread's `messagesMap` bucket through the SAME context-resolution
 * path the main agent uses — no special-cased threadId override on the
 * dispatch boundary.
 *
 * Subagent streaming mirrors the main agent's gateway-handler flow:
 * DB writes are authoritative (see `persistSubagent*Chunk` +
 * `persistToolBatch`) and these dispatches feed the UI the same content
 * as tokens arrive, so the Thread view streams with the same cadence as
 * the main bubble. `fetchAndReplaceMessages` (main-topic scoped) never
 * refreshes the thread bucket, so without these dispatches the Thread
 * would only show stale DB state until the user re-navigates.
 */
interface SubagentStoreDispatcher {
  /** Push a new message into the thread bucket (user / assistant / tool). */
  create: (msg: UIChatMessage) => void;
  /** Atomically replace pluginState and advance its optimistic watermark. */
  replacePluginState: (
    id: string,
    pluginState: Record<string, unknown>,
    metadata: NonNullable<UIChatMessage['metadata']>,
  ) => void;
  /** Update a message already in the thread bucket by id. */
  update: (id: string, value: Partial<UIChatMessage>) => void;
}

const HETERO_TERMINAL_PERSIST_DRAIN_TIMEOUT_MS = 10_000;
const HETERO_TERMINAL_EVENT_GRACE_TIMEOUT_MS = 3_000;

const waitForPersistQueue = async (
  queue: Promise<void>,
  label: string,
  timeoutMs = HETERO_TERMINAL_PERSIST_DRAIN_TIMEOUT_MS,
): Promise<boolean> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const result = await Promise.race<
    { error: unknown; status: 'rejected' } | { status: 'resolved' } | { status: 'timeout' }
  >([
    queue.then(
      () => ({ status: 'resolved' }),
      (error) => ({ error, status: 'rejected' }),
    ),
    new Promise<{ status: 'timeout' }>((resolve) => {
      timeoutId = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
    }),
  ]);

  if (timeoutId) clearTimeout(timeoutId);

  if (result.status === 'rejected') throw result.error;
  if (result.status === 'timeout') {
    console.warn(
      `[HeterogeneousAgent] persistQueue did not drain within ${timeoutMs}ms (${label}); continuing terminal flow.`,
    );
    return false;
  }

  return true;
};

interface MessageBatchMutationResult {
  results?: Array<{ error?: string; index: number; success: boolean }>;
  success?: boolean;
}

class MessageBatchMutationError extends Error {
  constructor(public readonly result: MessageBatchMutationResult) {
    const failed = result.results?.filter((item) => !item.success) ?? [];
    const reasons = [...new Set(failed.map((item) => item.error).filter(Boolean))];
    super(
      `messageService.batchMutate failed for ${failed.length || 'unknown'} operation(s)` +
        (reasons.length > 0 ? `: ${reasons.join('; ')}` : ''),
    );
  }
}

const mutateMessageBatch = async (operations: MessageBatchOperation[]): Promise<void> => {
  const batchMutate = (
    messageService as { batchMutate?: (operations: MessageBatchOperation[]) => Promise<any> }
  ).batchMutate;

  if (!batchMutate) {
    for (const operation of operations) {
      if (operation.type === 'createMessage') await messageService.createMessage(operation.message);
      else if (operation.type === 'updateToolMessage')
        await messageService.updateToolMessage(operation.id, operation.value);
      else await messageService.updateMessage(operation.id, operation.value);
    }
    return;
  }

  const result = (await batchMutate(operations)) as MessageBatchMutationResult;
  const failed = (result?.results ?? []).filter(
    (item: { success?: boolean }) => item.success === false,
  );
  if (result?.success === false || failed.length > 0) {
    throw new MessageBatchMutationError(result);
  }
};

/**
 * Execute a prompt via an external agent CLI.
 *
 * Flow:
 * 1. Subscribe to IPC broadcasts (`heteroAgentEvent` carrying `AgentStreamEvent`)
 * 2. Spawn agent process via heterogeneousAgentService
 * 3. Main runs JSONL framing + adapter + toStreamEvent (`AgentStreamPipeline`)
 *    so events arrive renderer-side already in the unified wire shape.
 * 4. Feed AgentStreamEvents into createGatewayEventHandler (unified handler)
 * 5. Tool messages created via messageService before emitting tool events
 */
export const executeHeterogeneousAgent = async (
  get: () => ChatStore,
  params: HeterogeneousAgentExecutorParams,
): Promise<void> => {
  const {
    heterogeneousProvider,
    contextSelections,
    assistantMessageId,
    context,
    imageList,
    message,
    operationId,
    pageSelections,
    resumeSessionId,
    workingDirectory,
    workingDirectoryConfig,
  } = params;

  const adapterType = resolveAdapterType(heterogeneousProvider);

  // Shared run lifecycle — hetero owns its terminal lifecycle here
  // (the desktop notification via `afterRunComplete`); queued persistence + op
  // completion stay in this executor's flow because the resume-session-id save
  // must run before queued follow-up sends. `parentMessage*` are unused for non-client.
  const runScope: RunScope = context.scope === 'sub_agent' ? 'sub_agent' : 'top_level';
  const runLifecycle = buildRunLifecycle(get, {
    context,
    parentMessageId: assistantMessageId,
    parentMessageType: 'assistant',
    runId: operationId,
    runScope,
    runtimeType: 'hetero',
  });

  // Create the unified event handler (same one Gateway uses). `runtimeType:
  // 'hetero'` keeps the handler to per-event message reconciliation only — this
  // executor owns the terminal lifecycle (notification + queued follow-up sends), so the
  // handler must NOT double-notify or drain. It still completes the op + marks
  // unread on a clean terminal (the legacy reconciliation path this flow relies on).
  const eventHandler = createGatewayEventHandler(get, {
    assistantMessageId,
    context,
    operationId,
    runtimeType: 'hetero',
  });
  const persistTerminalError = async (
    messageError: ChatMessageError,
    options?: { clearContent?: boolean },
  ) => {
    writeTopicStatus('failed');
    get().internal_toggleToolCallingStreaming(mainState.currentAssistantId, undefined);
    get().completeOperation(operationId);

    if (options?.clearContent) {
      await messageService
        .updateMessage(
          mainState.currentAssistantId,
          { content: '' },
          {
            agentId: context.agentId,
            topicId: context.topicId,
          },
        )
        .catch(console.error);
    }

    const updateResult = await messageService
      .updateMessageError(mainState.currentAssistantId, messageError, {
        agentId: context.agentId,
        groupId: context.groupId,
        threadId: context.threadId,
        topicId: context.topicId,
      })
      .catch(console.error);

    if (updateResult?.success && updateResult.messages) {
      get().replaceMessages(updateResult.messages, { context });
    } else {
      await get().refreshMessages().catch(console.error);
    }

    get().internal_dispatchMessage(
      {
        id: mainState.currentAssistantId,
        type: 'updateMessage',
        value: {
          ...(options?.clearContent ? { content: '' } : {}),
          error: messageError,
        },
      },
      { operationId },
    );
  };

  let agentSessionId: string | undefined;
  let unsubscribe: (() => void) | undefined;
  let completed = false;
  let fallbackPromise: Promise<void> | undefined;
  let resumeFallbackTriggered = false;

  /**
   * CC-native session id this run is producing, captured off the stream_start
   * event stream and stamped on every message created below. Mirrors the server
   * handler's `OperationState.heteroSessionId`: `topic.metadata.heteroSessionId`
   * only keeps the single latest value (written at run end), so a per-message
   * copy is what lets a diff pinpoint the exact row where CC forked to a new
   * session — the forensic signal for a lost-`--resume` "session break".
   */
  let heteroSessionId: string | undefined;

  /**
   * Per-message provenance stamped on every row this run persists: the CC
   * session id (`heteroSessionId`) and, when known, the turn's CC `message.id`
   * (`heteroMessageId`). Returns `{}` when neither is known so callers can
   * spread it without minting empty metadata. Mirrors the server handler's
   * `heteroProvenance`.
   */
  const heteroProvenance = (
    heteroMessageId?: string,
  ): { heteroMessageId?: string; heteroSessionId?: string } => {
    const out: { heteroMessageId?: string; heteroSessionId?: string } = {};
    if (heteroSessionId) out.heteroSessionId = heteroSessionId;
    if (heteroMessageId) out.heteroMessageId = heteroMessageId;
    return out;
  };

  /**
   * Global `tool_use.id → tool message DB id` lookup, shared across the
   * main agent and every subagent run. `tool_result` events identify
   * the target row by `toolCallId` alone (no scope context needed), so
   * one flat map keeps the lookup trivial. Interpreter-owned (NOT reducer
   * state — it maps to DB row ids the reducer pre-allocates): populated when
   * `applyMainIntent` / `applySubagentIntent` create tool messages, read by
   * `persistToolResult` and the intervention handlers.
   */
  const toolMsgIdByCallId: Map<string, string> = new Map();
  const lastAppliedToolStateSeqByCallId = new Map<string, number>();
  const mainToolCallIds = new Set<string>();
  /** Terminal results reject later state until a new tool_start reopens the call id. */
  const completedToolStateCallIds = new Set<string>();
  /** Final tool_result supersedes every pending non-terminal state retry. */
  const terminalToolMessageIds = new Set<string>();
  const pendingInterventionRequests = new Map<string, AgentInterventionRequestData>();
  const pendingInterventionResponses = new Map<string, AgentInterventionResponseData>();
  /**
   * Shared main-agent run coordinator state — the pure reducer in
   * `@lobechat/heterogeneous-agents`. Owns the main turn/step state machine
   * (content accumulation, the `asst → tool → asst` parent chain incl. the
   * `lastToolMsgIdEver` toolless-step rescue) AND the nested subagent runs
   * (delegated to `reduceSubagentRuns`). The renderer interpreters
   * (`applyMainIntent` / `applySubagentIntent`) map its intents onto DB writes
   * + live UI. Reassigned (commit-on-success) by `reduceAndApplyMain`.
   */
  let mainState: MainAgentRunState = createMainAgentRunState(assistantMessageId);
  /**
   * Per-thread UI handles the reducer doesn't model: the thread-scoped store
   * dispatcher + its sub-operation id. Created on the `createThread` intent,
   * keyed by threadId, consumed by later intents for the same thread.
   */
  const subagentThreads = new Map<
    string,
    { stream: SubagentStoreDispatcher; subOperationId: string }
  >();
  /**
   * Renderer-local flush retry, keyed by threadId. A `persistContent` whose DB
   * write throws stashes its (pinned messageId + content) here instead of
   * losing the streamed buffer; the next successful `persistContent` for the
   * thread clears it, and `onComplete` replays any survivors. Preserves the
   * old `pendingFlushTarget` resilience without the reducer (which is pure)
   * having to model transient I/O failure.
   */
  const pendingSubagentFlush = new Map<
    string,
    { content?: string; messageId: string; reasoning?: string }
  >();
  /**
   * Renderer-local retry for main assistant durable flushes. Main `streamContent`
   * is live-UI only, so a transient `persistAssistant` failure would otherwise
   * be lost once the reducer clears `accContent` on terminal.
   */
  const pendingMainFlush = new Map<string, Record<string, any>>();
  /** Retry ledger for the latest non-superseded tool write. */
  const pendingToolFlush = new Map<string, ToolMessageUpdateOperation['value']>();

  /** Later intents carry a superset of the payload, so a shallow merge wins. */
  const stashMainFlush = (messageId: string, update: Record<string, any>) => {
    pendingMainFlush.set(messageId, { ...pendingMainFlush.get(messageId), ...update });
  };
  /** Serializes async persist operations so ordering is stable. */
  let persistQueue: Promise<void> = Promise.resolve();
  /**
   * Deferred terminal event (agent_runtime_end or error). We don't forward
   * these to the gateway handler immediately because handler triggers
   * fetchAndReplaceMessages which would clobber our in-flight content
   * writes with stale DB state. onComplete forwards after persistence.
   */
  let deferredTerminalEvent: AgentStreamEvent | null = null;
  let terminalEventWaiters: Array<() => void> = [];
  const notifyTerminalEvent = () => {
    const waiters = terminalEventWaiters;
    terminalEventWaiters = [];
    for (const resolve of waiters) resolve();
  };
  const waitForTerminalEvent = (ms: number): Promise<void> => {
    if (deferredTerminalEvent) return Promise.resolve();

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        terminalEventWaiters = terminalEventWaiters.filter((waiter) => waiter !== finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      terminalEventWaiters.push(finish);
    });
  };
  let completionCallbackPromise: Promise<void> | null = null;
  const runCompletionCallback = (callback: () => Promise<void>): Promise<void> => {
    if (completionCallbackPromise) return completionCallbackPromise;

    completionCallbackPromise = callback().catch((err) => {
      console.error('[HeterogeneousAgent] completion callback failed:', err);
    });
    return completionCallbackPromise;
  };
  const waitForCompletionCallback = async () => {
    const promise = completionCallbackPromise;
    if (promise) await promise;
  };
  /**
   * True while a step transition is in flight (stream_start queued but not yet
   * forwarded to handler). Events that would normally be forwarded sync must
   * be deferred through persistQueue so the handler receives stream_start first.
   * Without this, tools_calling gets dispatched to the OLD assistant → orphan.
   */
  let pendingStepTransition = false;
  /**
   * Set synchronously the moment any output-bearing stream event (stream_chunk /
   * tool_result) ARRIVES, before it's queued onto `persistQueue`. The reducer
   * now accumulates content/tools/subagent state only INSIDE the queued
   * `reduceAndApplyMain`, so `hasStreamedState()` (which reads `mainState`) is
   * blind to events that arrived but haven't drained yet. `retryWithoutResume`
   * runs its guard synchronously in `onError` BEFORE awaiting the queue, so
   * without this flag a recoverable resume error landing after partial output
   * was queued could start a second run and duplicate/interleave messages.
   */
  let sawStreamedEvent = false;

  const getCurrentFrontendMessages = () =>
    (get().dbMessagesMap?.[messageMapKey(context)] ??
      get().messagesMap?.[messageMapKey(context)] ??
      []) as UIChatMessage[];

  const attachInitialAssistantSeed = (event: AgentStreamEvent): void => {
    if (event.type !== 'stream_start') return;
    if ((event.data as { newStep?: boolean } | undefined)?.newStep) return;
    const data = (event.data ?? {}) as Record<string, any>;
    if (data.assistantMessage?.id) return;

    data.assistantMessage = {
      agentId: context.agentId,
      id: mainState.currentAssistantId,
      model: data.model,
      provider: data.provider,
      role: 'assistant',
      topicId: context.topicId ?? undefined,
    };
    event.data = data;
  };

  const attachTerminalFrontendSnapshot = (event: AgentStreamEvent): void => {
    if (event.type !== 'agent_runtime_end') return;
    const data = (event.data ?? {}) as Record<string, any>;
    if (Array.isArray(data.uiMessages)) return;

    const uiMessages = getCurrentFrontendMessages();
    if (uiMessages.length === 0) return;
    event.data = { ...data, uiMessages };
  };

  // Subscribe to the operation's abort signal so we can drop late events and
  // stop writing to DB the moment the user clicks Stop. If the op is gone
  // (cleaned up already) or missing in a test stub, treat as not-aborted.
  const abortSignal = get().operations?.[operationId]?.abortController?.signal;
  const isAborted = () => !!abortSignal?.aborted;
  const updateTopicMetadata = get().updateTopicMetadata;
  const getPersistedWorkingDirectoryConfig = (
    topicMetadata: ChatTopicMetadata | undefined,
  ): WorkingDirConfig | undefined =>
    // Prefer the topic's CURRENT config: while the CLI runs, GitStatus may have
    // persisted richer branch/PR/CI (`git.github`) onto it. Falling back to the
    // run-start captured config would drop that enrichment on the completion
    // write until a status component re-probes. Captured config is only the
    // fallback for a topic that carries none yet.
    topicMetadata?.workingDirectoryConfig ??
    workingDirectoryConfig ??
    (workingDirectory === undefined ? undefined : { path: workingDirectory });
  const hasStreamedState = () =>
    sawStreamedEvent ||
    !!mainState.accContent ||
    !!mainState.accReasoning ||
    mainState.toolState.payloads.length > 0 ||
    toolMsgIdByCallId.size > 0 ||
    mainState.subagents.runs.size > 0;
  const clearStaleResumeMetadata = async () => {
    if (!context.topicId || !updateTopicMetadata) return;

    const topicMetadata = getTopicMetadataById(get(), context.topicId);
    await updateTopicMetadata(context.topicId, {
      heteroSessionId: undefined,
      heteroSessionIdByWorkingDirectory: removeHeteroSessionIdForWorkingDirectory(
        topicMetadata,
        workingDirectory,
      ),
      workingDirectory: workingDirectory ?? '',
      workingDirectoryConfig: getPersistedWorkingDirectoryConfig(topicMetadata),
    });
  };
  let persistedResumeSessionId: string | undefined;
  let pendingResumeSessionId: string | undefined;
  let resumeSessionPersistQueue: Promise<void> = Promise.resolve();
  const persistResumeSessionId = (sessionId: string, source: string): Promise<void> => {
    const topicId = context.topicId ?? undefined;
    if (!topicId || !updateTopicMetadata) return resumeSessionPersistQueue;
    if (sessionId === persistedResumeSessionId || sessionId === pendingResumeSessionId) {
      return resumeSessionPersistQueue;
    }

    pendingResumeSessionId = sessionId;
    resumeSessionPersistQueue = resumeSessionPersistQueue
      .catch(() => {})
      .then(async () => {
        const topicMetadata = getTopicMetadataById(get(), topicId);
        await updateTopicMetadata(topicId, {
          heteroSessionId: sessionId,
          heteroSessionIdByWorkingDirectory: setHeteroSessionIdForWorkingDirectory(
            topicMetadata,
            workingDirectory,
            sessionId,
          ),
          workingDirectory: workingDirectory ?? '',
          workingDirectoryConfig: getPersistedWorkingDirectoryConfig(topicMetadata),
        });
        persistedResumeSessionId = sessionId;
      })
      .catch((err) => {
        console.error(`[HeterogeneousAgent] Failed to persist resume session id (${source}):`, err);
      })
      .finally(() => {
        if (pendingResumeSessionId === sessionId) pendingResumeSessionId = undefined;
      });

    return resumeSessionPersistQueue;
  };
  const writeTopicStatus = (status: ChatTopicStatus): void => {
    if (!context.topicId) return;
    void get().updateTopicStatus?.({
      agentId: context.agentId,
      groupId: context.groupId,
      status,
      topicId: context.topicId,
    });
  };
  const updateMessageOrThrow = async (messageId: string, update: Record<string, any>) => {
    const result = await messageService.updateMessage(messageId, update, {
      agentId: context.agentId,
      topicId: context.topicId,
    });
    if (result?.success === false) {
      throw new Error(`messageService.updateMessage returned success=false for ${messageId}`);
    }
  };
  const messageWriteCtx: MessageQueryContext = {
    agentId: context.agentId,
    topicId: context.topicId,
  };
  const messageWriteBatcher = createMessageWriteBatcher({
    batchMutate: (
      messageService as { batchMutate?: (operations: MessageBatchOperation[]) => Promise<any> }
    ).batchMutate,
    createMessage: messageService.createMessage,
    updateMessage: messageService.updateMessage,
    updateToolMessage: messageService.updateToolMessage,
  });

  /** Failed-create retry ledger + the FK-parent barrier for straight-through writes. */
  const pendingCreateLedger = createPendingCreateLedger({
    createMessage: messageService.createMessage,
    flush: messageWriteBatcher.flush,
  });

  const enqueueMainToolResult = (
    toolCallId: string,
    content: string,
    isError: boolean,
    pluginState?: Record<string, any>,
  ) => {
    if (!mainToolCallIds.has(toolCallId)) return;

    completedToolStateCallIds.add(toolCallId);
    const toolMsgId = toolMsgIdByCallId.get(toolCallId);
    if (!toolMsgId) {
      console.warn('[HeterogeneousAgent] tool_result for unknown toolCallId:', toolCallId);
      return;
    }

    terminalToolMessageIds.add(toolMsgId);
    pendingToolFlush.delete(toolMsgId);

    const toolUpdate = {
      content,
      pluginError: isError ? { message: content } : undefined,
      pluginState,
    };
    messageWriteBatcher.enqueueToolMessageUpdate(toolMsgId, toolUpdate, messageWriteCtx, (err) => {
      console.error('[HeterogeneousAgent] Failed to update tool message content:', err);
      pendingToolFlush.set(toolMsgId, toolUpdate);
    });
  };
  const claimToolStateSnapshot = (
    toolCallId: string,
    toolMsgId: string,
    snapshotSeq: number,
  ): NonNullable<UIChatMessage['metadata']> | undefined => {
    const stored = dbMessageSelectors.getDbMessageById(toolMsgId)(get());
    const durableSeq =
      stored?.metadata?.heterogeneousToolStateOperationId === operationId &&
      typeof stored.metadata.heterogeneousToolStateSeq === 'number'
        ? stored.metadata.heterogeneousToolStateSeq
        : 0;
    const lastApplied = Math.max(durableSeq, lastAppliedToolStateSeqByCallId.get(toolCallId) ?? 0);
    if (snapshotSeq <= lastApplied) return;

    lastAppliedToolStateSeqByCallId.set(toolCallId, snapshotSeq);
    return {
      heterogeneousToolStateOperationId: operationId,
      heterogeneousToolStateSeq: snapshotSeq,
    };
  };
  const applyInterventionRequest = async (data: AgentInterventionRequestData): Promise<boolean> => {
    const toolMsgId = toolMsgIdByCallId.get(data.toolCallId);
    if (!toolMsgId) return false;

    // The id is pre-allocated before the batched createMessage has necessarily
    // flushed. Persist the row before writing plugin/intervention state.
    await messageWriteBatcher.flush('before-intervention-request');

    try {
      await get().optimisticUpdateMessagePlugin(
        toolMsgId,
        { intervention: { status: 'pending' } },
        { operationId },
      );
      // Sidebar topic row swaps the running spinner for a hand icon
      // so it's obvious from the topic list that this conversation is
      // blocked on the user, not still streaming.
      writeTopicStatus('waitingForHuman');
      // Parity with the homogeneous approval paths (client / gateway /
      // aiAgent): a CC AskUserQuestion now also bumps the dock badge and
      // bounces the macOS dock. The helper is desktop-guarded and only
      // requests attention while the window is hidden/unfocused, so it's
      // a no-op when the user is already looking at the approval.
      void notifyDesktopHumanApprovalRequired(get, context);
    } catch (err) {
      console.error('[HeterogeneousAgent] persist intervention pending failed:', err);
    }

    return true;
  };
  const applyInterventionResponse = async (
    data: AgentInterventionResponseData,
  ): Promise<boolean> => {
    const { cancelled, cancelReason, toolCallId } = data;
    if (!cancelled) return true;
    if (cancelReason === 'user_cancelled') return true;

    const toolMsgId = toolMsgIdByCallId.get(toolCallId);
    if (!toolMsgId) return false;

    await messageWriteBatcher.flush('before-intervention-response');

    try {
      await get().optimisticUpdateMessagePlugin(
        toolMsgId,
        {
          intervention: {
            rejectedReason: cancelReason ?? 'session_ended',
            status: 'rejected',
          },
        },
        { operationId },
      );
      // Bridge resolved without the user — drop the hand state so the
      // sidebar reflects that we're back to whatever the stream does
      // next (`active`/`failed` lands shortly after via runtime_end).
      writeTopicStatus('running');
    } catch (err) {
      console.error('[HeterogeneousAgent] persist intervention rejection failed:', err);
    }

    return true;
  };
  const replayPendingInterventionsForToolCall = async (toolCallId: string): Promise<void> => {
    const request = pendingInterventionRequests.get(toolCallId);
    if (request && (await applyInterventionRequest(request))) {
      pendingInterventionRequests.delete(toolCallId);
    }

    const response = pendingInterventionResponses.get(toolCallId);
    if (response && (await applyInterventionResponse(response))) {
      pendingInterventionResponses.delete(toolCallId);
    }
  };
  const retryWithoutResume = (error: unknown): boolean => {
    if (
      resumeFallbackTriggered ||
      !resumeSessionId ||
      !isRecoverableResumeError(error) ||
      hasStreamedState()
    ) {
      return false;
    }

    resumeFallbackTriggered = true;
    completed = true;
    fallbackPromise = (async () => {
      await clearStaleResumeMetadata().catch(console.error);
      antdMessage?.info?.(t('heteroAgent.resumeReset.resumeFailed', { ns: 'chat' }));
      await executeHeterogeneousAgent(get, { ...params, resumeSessionId: undefined });
    })();

    return true;
  };

  /**
   * Invoked by `ensureSubagentRun` once per lazy Thread creation so the
   * UI's thread-list SWR cache refreshes mid-stream. Without this, a new
   * subagent Thread born during an in-flight CC run stays invisible in
   * the sidebar until the user navigates topics / refreshes — they see
   * the main-agent Agent tool_use but no Thread entry linking to the
   * subagent conversation.
   *
   * Fire-and-forget: `refreshThreads` is a no-op when the user has
   * navigated away from the topic, so there's no need to block persist
   * on this call.
   */
  const onSubagentThreadCreated = () => {
    const refresh = get().refreshThreads;
    if (typeof refresh === 'function') refresh().catch(console.error);
  };

  /**
   * Open the per-spawn sub-operation that carries the subagent Thread's
   * `ConversationContext` (threadId + scope='thread'), then build a
   * dispatcher bound to that sub-op's id. This routes every create /
   * update through the standard `internal_getConversationContext` ->
   * `messageMapKey` resolution path the main agent already uses, so no
   * per-dispatch threadId override is needed at the store boundary.
   *
   * Lifecycle: the sub-op is a child of the main `operationId` (so
   * cancellation cascades + cleanup are free). It's marked completed
   * on the coordinator's `finalizeThread` intent — fired when the spawn's
   * tool_result arrives on main, and again via the `onComplete` orphan drain
   * for any spawn whose tool_result never landed (CLI crash, abort).
   */
  const beginSubagentRun = (
    threadId: string,
  ): { stream: SubagentStoreDispatcher; subOperationId: string } => {
    const subOp = get().startOperation({
      context: { ...context, scope: 'thread' as MessageMapScope, threadId },
      parentOperationId: operationId,
      type: 'subagentThread',
    });
    const dispatchCtx = { operationId: subOp.operationId };
    return {
      stream: {
        create(msg) {
          get().internal_dispatchMessage(
            { id: msg.id, type: 'createMessage', value: msg as any },
            dispatchCtx,
          );
        },
        replacePluginState(id, pluginState, metadata) {
          get().internal_dispatchMessage(
            { id, metadata, type: 'replaceMessagePluginState', value: pluginState },
            dispatchCtx,
          );
        },
        update(id, value) {
          get().internal_dispatchMessage(
            { id, type: 'updateMessage', value: value as any },
            dispatchCtx,
          );
        },
      },
      subOperationId: subOp.operationId,
    };
  };

  const getSubagentThread = (threadId: string) => {
    const existing = subagentThreads.get(threadId);
    if (existing) return existing;

    const created = beginSubagentRun(threadId);
    subagentThreads.set(threadId, created);
    return created;
  };

  const rehydrateClientSubagentRuns = async (): Promise<void> => {
    if (!context.topicId) return;

    try {
      const threads = await threadService.getThreads(context.topicId);
      const snapshots: SubagentRunSnapshot[] = [];
      const finalizedParents: string[] = [];

      for (const thread of threads) {
        if (thread.type !== ThreadType.Isolation) continue;
        const parentToolCallId = thread.metadata?.sourceToolCallId;
        if (!parentToolCallId) continue;

        if (thread.status !== ThreadStatus.Processing) {
          finalizedParents.push(parentToolCallId);
          continue;
        }

        const messages = await messageService.getMessages({
          threadId: thread.id,
          topicId: context.topicId,
        });
        const currentAssistant = messages.findLast((message) => message.role === 'assistant');
        if (!currentAssistant) continue;

        const toolRows = messages.filter(
          (message) => message.role === 'tool' && message.tool_call_id,
        );
        for (const message of toolRows) {
          toolMsgIdByCallId.set(message.tool_call_id!, message.id);
        }
        const subagentMessageId = (currentAssistant.metadata as Record<string, unknown> | null)
          ?.subagentMessageId;

        snapshots.push({
          currentAssistantId: currentAssistant.id,
          currentSubagentMessageId:
            typeof subagentMessageId === 'string' ? subagentMessageId : undefined,
          lastChainParentId: currentAssistant.id,
          lifetimeToolCallIds: toolRows.map((message) => message.tool_call_id!),
          parentToolCallId,
          threadId: thread.id,
        });
      }

      mainState = {
        ...mainState,
        subagents: rehydrateSubagentRunsState(snapshots, finalizedParents),
      };
    } catch (err) {
      console.error('[HeterogeneousAgent] Failed to rehydrate client subagent runs:', err);
    }
  };

  /**
   * Mark a per-spawn sub-operation completed. Wrapper around
   * `completeOperation` so the coordinator interpreter (`finalizeThread`)
   * stays free of store coupling. Idempotent: `completeOperation` on an
   * already-completed op is a no-op.
   */
  const completeSubagentOp = (subOperationId: string) => {
    get().completeOperation(subOperationId);
  };

  // ─── Subagent run coordinator (shared reducer) interpreter ───────────────

  /**
   * Apply ONE coordinator intent against the renderer's surfaces: DB via
   * `messageService` / `threadService` AND the thread-scoped store dispatcher
   * (so the Thread view streams in step with the DB, exactly as the standalone
   * helpers used to). Best-effort per op (errors logged), mirroring the prior
   * persist helpers.
   */
  const applySubagentIntent = async (intent: SubagentIntent) => {
    // Narrows `context.topicId` to `string` for every DB write below (the
    // caller already guards, but this function is a separate closure). All
    // subagent rows are topic-scoped.
    if (!context.topicId) return;

    // Both of these hang off the main assistant row, which may still be sitting in
    // the write batcher (or have failed to write at all). `createThread` is gated
    // as well: its own `sourceMessageId` has no FK, but letting it through against
    // a missing parent just buys an orphan thread whose seed `createMessage` fails
    // a moment later.
    if (intent.kind === 'createThread')
      await pendingCreateLedger.ensureParentPersisted(intent.sourceMessageId);
    if (intent.kind === 'createMessage')
      await pendingCreateLedger.ensureParentPersisted(intent.parentId);

    switch (intent.kind) {
      case 'createThread': {
        try {
          await threadService.createThread({
            id: intent.threadId,
            metadata: {
              operationId,
              sourceToolCallId: intent.sourceToolCallId,
              startedAt: new Date().toISOString(),
              subagentType: intent.subagentType,
            },
            sourceMessageId: intent.sourceMessageId,
            status: ThreadStatus.Processing,
            title: intent.title,
            topicId: context.topicId,
            type: ThreadType.Isolation,
          });
        } catch (err) {
          // Rethrow so `reduceAndApplyMain` skips the state commit — the
          // run stays absent and the next chunk retries the lazy create.
          console.error('[HeterogeneousAgent] Failed to create subagent thread:', err);
          throw err;
        }
        onSubagentThreadCreated();
        // Open the per-spawn sub-op + dispatcher so subsequent intents for this
        // thread route into the Thread's messagesMap bucket.
        subagentThreads.set(intent.threadId, beginSubagentRun(intent.threadId));
        return;
      }

      case 'createMessage': {
        const t = getSubagentThread(intent.threadId);
        const subMetadata = heteroProvenance(intent.subagentMessageId);
        const msg = {
          agentId: intent.agentId ?? undefined,
          content: intent.content,
          id: intent.messageId,
          ...(Object.keys(subMetadata).length > 0 ? { metadata: subMetadata } : {}),
          parentId: intent.parentId,
          role: intent.role,
          threadId: intent.threadId,
          topicId: context.topicId,
        };
        try {
          await mutateMessageBatch([{ message: msg, type: 'createMessage' }]);
        } catch (err) {
          // Rethrow so `reduceAndApplyMain` skips the state commit — the
          // run keeps its pre-create shape and the next event re-emits the
          // turn-boundary / lazy-create with fresh ids.
          console.error('[HeterogeneousAgent] Failed to create subagent message:', err);
          throw err;
        }
        t?.stream.create(msg as UIChatMessage);
        return;
      }

      // Live token-level UI only — no DB write (durable content lands via
      // persistContent / persistToolBatch). Mirrors the old text-chunk path.
      case 'streamContent': {
        const t = getSubagentThread(intent.threadId);
        const value: Partial<UIChatMessage> = {};
        if (intent.content !== undefined) value.content = intent.content;
        if (intent.reasoning !== undefined)
          (value as any).reasoning = { content: intent.reasoning };
        t?.stream.update(intent.messageId, value);
        return;
      }

      case 'persistContent': {
        const t = getSubagentThread(intent.threadId);
        const update: Record<string, any> = {};
        if (intent.content) update.content = intent.content;
        if (intent.reasoning) update.reasoning = { content: intent.reasoning };
        if (Object.keys(update).length === 0) return;
        try {
          await mutateMessageBatch([
            { id: intent.messageId, type: 'updateMessage', value: update },
          ]);
          // Success drains any prior pending flush for this thread.
          pendingSubagentFlush.delete(intent.threadId);
          t?.stream.update(intent.messageId, update as Partial<UIChatMessage>);
        } catch (err) {
          // Transient failure: stash the buffer pinned to THIS message id so
          // the onComplete replay retries it against the original turn's
          // assistant — never the terminal row the reducer advanced onto.
          console.error('[HeterogeneousAgent] Failed to flush subagent content:', err);
          pendingSubagentFlush.set(intent.threadId, {
            content: intent.content,
            messageId: intent.messageId,
            reasoning: intent.reasoning,
          });
        }
        return;
      }

      case 'persistToolBatch': {
        const t = getSubagentThread(intent.threadId);
        const buildUpdate = (withResult: boolean): Record<string, any> => {
          const update: Record<string, any> = {
            tools: intent.tools.map((x) =>
              withResult ? { ...x.payload, result_msg_id: x.toolMessageId } : { ...x.payload },
            ),
          };
          if (intent.content) update.content = intent.content;
          if (intent.reasoning) update.reasoning = { content: intent.reasoning };
          return update;
        };

        const operations: MessageBatchOperation[] = [
          {
            id: intent.assistantMessageId,
            type: 'updateMessage',
            value: buildUpdate(false),
          },
        ];
        const newToolMessages: Array<{
          message: UIChatMessage;
          operationIndex: number;
          toolCallId: string;
        }> = [];

        for (const x of intent.tools) {
          if (!x.isNew) continue;
          const subToolMetadata = heteroProvenance(intent.subagentMessageId);
          const toolMsg = {
            agentId: context.agentId,
            content: '',
            id: x.toolMessageId,
            ...(Object.keys(subToolMetadata).length > 0 ? { metadata: subToolMetadata } : {}),
            parentId: intent.assistantMessageId,
            plugin: {
              apiName: x.payload.apiName,
              arguments: x.payload.arguments,
              identifier: x.payload.identifier,
              type: x.payload.type as ChatToolPayload['type'],
            },
            role: 'tool' as const,
            threadId: intent.threadId,
            tool_call_id: x.payload.id,
            topicId: context.topicId,
          };
          operations.push({ message: toolMsg, type: 'createMessage' });
          newToolMessages.push({
            message: toolMsg as UIChatMessage,
            operationIndex: operations.length - 1,
            toolCallId: x.payload.id,
          });
        }
        operations.push({
          id: intent.assistantMessageId,
          type: 'updateMessage',
          value: buildUpdate(true),
        });

        let persistedToolMessages = newToolMessages;
        try {
          await mutateMessageBatch(operations);
        } catch (err) {
          console.error('[HeterogeneousAgent] Failed to persist subagent tool batch:', err);
          if (!(err instanceof MessageBatchMutationError)) return;

          const succeededIndexes = new Set(
            err.result.results?.filter((item) => item.success).map((item) => item.index) ?? [],
          );
          persistedToolMessages = newToolMessages.filter(({ operationIndex }) =>
            succeededIndexes.has(operationIndex),
          );
        }

        for (const { message, toolCallId } of persistedToolMessages) {
          toolMsgIdByCallId.set(toolCallId, message.id);
          t?.stream.create(message);
          await replayPendingInterventionsForToolCall(toolCallId);
        }

        // Surface the live assistant tools[] + content into the thread bucket.
        t?.stream.update(intent.assistantMessageId, buildUpdate(true) as Partial<UIChatMessage>);
        return;
      }

      case 'resolveToolResult': {
        const t = getSubagentThread(intent.threadId);
        completedToolStateCallIds.add(intent.toolCallId);
        const toolMsgId = toolMsgIdByCallId.get(intent.toolCallId);
        if (toolMsgId) {
          terminalToolMessageIds.add(toolMsgId);
          pendingToolFlush.delete(toolMsgId);
          const update: ToolMessageUpdateOperation['value'] = {
            content: intent.content,
            pluginError: intent.isError ? { message: intent.content } : undefined,
            pluginState: intent.pluginState,
          };
          try {
            await mutateMessageBatch([{ id: toolMsgId, type: 'updateToolMessage', value: update }]);
          } catch (err) {
            console.error('[HeterogeneousAgent] Failed to persist subagent tool result:', err);
            pendingToolFlush.set(toolMsgId, update);
          }
          t?.stream.update(toolMsgId, update as Partial<UIChatMessage>);
        }
        return;
      }

      case 'updateToolState': {
        if (completedToolStateCallIds.has(intent.toolCallId)) return;

        const t = getSubagentThread(intent.threadId);
        const toolMsgId = toolMsgIdByCallId.get(intent.toolCallId);
        if (!toolMsgId) {
          console.warn(
            '[HeterogeneousAgent] tool_state for unknown subagent toolCallId:',
            intent.toolCallId,
          );
          return;
        }

        const metadata = claimToolStateSnapshot(intent.toolCallId, toolMsgId, intent.snapshotSeq);
        if (!metadata) return;

        const update: ToolMessageUpdateOperation['value'] = {
          heterogeneousToolState: {
            operationId,
            snapshotSeq: intent.snapshotSeq,
          },
          pluginState: intent.pluginState,
        };
        try {
          await mutateMessageBatch([{ id: toolMsgId, type: 'updateToolMessage', value: update }]);
        } catch (err) {
          console.error('[HeterogeneousAgent] Failed to persist subagent tool state:', err);
          if (!terminalToolMessageIds.has(toolMsgId)) {
            pendingToolFlush.set(toolMsgId, { ...pendingToolFlush.get(toolMsgId), ...update });
          }
        }
        t.stream.replacePluginState(toolMsgId, intent.pluginState, metadata);
        return;
      }

      case 'recordUsage': {
        const t = getSubagentThread(intent.threadId);
        const update = {
          // Wholesale metadata overwrite — re-stamp the session + message
          // provenance the createMessage write put there, or usage would wipe it.
          metadata: {
            ...heteroProvenance(intent.subagentMessageId),
            usage: intent.usage as any,
          },
          ...(intent.model && { model: intent.model }),
          ...(intent.provider && { provider: intent.provider }),
        };
        t?.stream.update(intent.messageId, update as Partial<UIChatMessage>);
        try {
          await messageService.updateMessage(intent.messageId, update, {
            agentId: context.agentId,
            topicId: context.topicId,
          });
        } catch (err) {
          console.error('[HeterogeneousAgent] Failed to record subagent usage:', err);
        }
        return;
      }

      case 'finalizeThread': {
        try {
          await threadService.updateThread(intent.threadId, { status: ThreadStatus.Active });
        } catch (err) {
          console.error('[HeterogeneousAgent] Failed to mark subagent thread complete:', err);
        }
        const t = getSubagentThread(intent.threadId);
        if (t) completeSubagentOp(t.subOperationId);
        return;
      }
    }
  };

  // ─── Main-agent run coordinator (shared reducer) interpreter ─────────────

  /**
   * Apply ONE main-scoped coordinator intent against the renderer's write-behind
   * DB queue plus the local raw-message bucket. Best-effort (errors logged,
   * never thrown) — mirroring the prior inline persist helpers, so the run state
   * always advances regardless of a transient DB failure (the next event /
   * terminal flush re-persists). Token-level text/reasoning still streams via the
   * gateway handler; tool rows and result links are local SoT here so tool_end
   * reconciliation does not need a DB fetch.
   */
  const applyMainIntent = async (intent: MainAgentIntent) => {
    switch (intent.kind) {
      case 'createAssistant': {
        const createMetadata: Record<string, any> = { ...heteroProvenance(intent.mainMessageId) };
        if (intent.signal) createMetadata.signal = intent.signal;
        const messageToCreate = {
          agentId: intent.agentId ?? context.agentId,
          content: '',
          id: intent.messageId,
          ...(Object.keys(createMetadata).length > 0 ? { metadata: createMetadata } : {}),
          model: intent.model,
          parentId: intent.parentId,
          provider: intent.provider,
          role: 'assistant',
          topicId: intent.topicId ?? context.topicId ?? undefined,
        } as any;
        messageWriteBatcher.enqueueCreateMessage(messageToCreate, (err) => {
          console.error('[HeterogeneousAgent] Failed to create step assistant:', err);
          pendingCreateLedger.add(intent.messageId, messageToCreate);
        });
        get().internal_dispatchMessage(
          { id: intent.messageId, type: 'createMessage', value: messageToCreate },
          { operationId },
        );
        // Associate so cancellation / cleanup tracks the new step's message.
        get().associateMessageWithOperation(intent.messageId, operationId);
        return;
      }

      // Durable flush of content/reasoning/model/provider/metadata.
      case 'persistAssistant': {
        const update: Record<string, any> = {};
        if (intent.content !== undefined) update.content = intent.content;
        if (intent.reasoning !== undefined) update.reasoning = { content: intent.reasoning };
        if (intent.model) update.model = intent.model;
        if (intent.provider) update.provider = intent.provider;
        if (intent.metadata) update.metadata = intent.metadata;
        if (Object.keys(update).length === 0) return;
        messageWriteBatcher.enqueueUpdateMessage(
          intent.messageId,
          update,
          messageWriteCtx,
          (err) => {
            console.error('[HeterogeneousAgent] Failed to flush main assistant:', err);
            stashMainFlush(intent.messageId, update);
          },
        );
        // Mirror ONLY model/provider into the store: content/reasoning already
        // stream live via the gateway handler's raw stream_chunk forward. The
        // CLI's model has no live path at all — the run's FIRST assistant is
        // already in `dbMessagesMap` when the run starts, so the gateway's
        // stream_start seed insert (its one model→store hop) is skipped for it
        // and the flush above is DB-only. `provider` is already seeded from the
        // agent config; re-stamping it keeps the store and the row identical.
        const liveUpdate: Record<string, any> = {};
        if (intent.model) liveUpdate.model = intent.model;
        if (intent.provider) liveUpdate.provider = intent.provider;
        if (Object.keys(liveUpdate).length > 0) {
          get().internal_dispatchMessage(
            { id: intent.messageId, type: 'updateMessage', value: liveUpdate },
            { operationId },
          );
        }
        return;
      }

      // No-op ON PURPOSE — not dead code. Main-agent live token UI is already
      // driven by forwarding the RAW stream_chunk to the gateway `eventHandler`
      // (see handleStreamEvent: it dispatches into `messagesMap` for live
      // display). Applying streamContent here too would be a redundant double
      // write. (Contrast the SUBAGENT interpreter, whose `streamContent` DOES
      // update the thread bucket — subagent events are dropped before the
      // gateway forward, so the intent is their only live-UI path.)
      // Verified: in-memory content streams 3→…→N while the op runs; the durable
      // write still lands via persistAssistant / persistToolBatch.
      case 'streamContent': {
        return;
      }

      case 'persistToolBatch': {
        const buildUpdate = (withResult: boolean): Record<string, any> => {
          const update: Record<string, any> = {
            tools: intent.tools.map((x) =>
              withResult ? { ...x.payload, result_msg_id: x.toolMessageId } : { ...x.payload },
            ),
          };
          if (intent.content) update.content = intent.content;
          if (intent.reasoning) update.reasoning = { content: intent.reasoning };
          return update;
        };

        const buildToolMessage = (x: (typeof intent.tools)[number]) => {
          const toolMetadata = heteroProvenance(mainState.currentMainMessageId);
          return {
            agentId: context.agentId,
            content: '',
            id: x.toolMessageId,
            ...(Object.keys(toolMetadata).length > 0 ? { metadata: toolMetadata } : {}),
            parentId: intent.assistantMessageId,
            plugin: {
              apiName: x.payload.apiName,
              arguments: x.payload.arguments,
              identifier: x.payload.identifier,
              type: x.payload.type as ChatToolPayload['type'],
            },
            role: 'tool',
            tool_call_id: x.payload.id,
            topicId: context.topicId ?? undefined,
          } as any;
        };

        // The ledger always carries the phase-3 shape: by the time it replays,
        // the tool rows exist, and stashing the phase-1 shape would let a stale
        // `tools[]` (no `result_msg_id`) clobber a phase-3 write that landed.
        const finalAssistantUpdate = buildUpdate(true);

        // Phase 1: pre-register assistant.tools[] (no result_msg_id yet) so the
        // conversation-flow parser finds matching ids the moment tool rows land.
        messageWriteBatcher.enqueueUpdateMessage(
          intent.assistantMessageId,
          buildUpdate(false),
          messageWriteCtx,
          (err) => {
            console.error('[HeterogeneousAgent] Failed to pre-register main tools:', err);
            stashMainFlush(intent.assistantMessageId, finalAssistantUpdate);
          },
        );

        // Phase 2: create rows for new tools with their pre-allocated ids and
        // register the global lookup so a later tool_result resolves.
        for (const x of intent.tools) {
          if (!x.isNew) continue;
          const toolMsg = buildToolMessage(x);
          messageWriteBatcher.enqueueCreateMessage(toolMsg, (err) => {
            console.error('[HeterogeneousAgent] Failed to create tool message:', err);
            pendingCreateLedger.add(x.toolMessageId, toolMsg);
          });
          toolMsgIdByCallId.set(x.payload.id, x.toolMessageId);
          mainToolCallIds.add(x.payload.id);
          get().internal_dispatchMessage(
            { id: x.toolMessageId, type: 'createMessage', value: toolMsg },
            { operationId },
          );
        }

        // Phase 3: backfill result_msg_id on assistant.tools[].
        messageWriteBatcher.enqueueUpdateMessage(
          intent.assistantMessageId,
          finalAssistantUpdate,
          messageWriteCtx,
          (err) => {
            console.error('[HeterogeneousAgent] Failed to finalize main tools:', err);
            stashMainFlush(intent.assistantMessageId, finalAssistantUpdate);
          },
        );
        get().internal_dispatchMessage(
          {
            id: intent.assistantMessageId,
            type: 'updateMessage',
            value: finalAssistantUpdate as Partial<UIChatMessage>,
          },
          { operationId },
        );
        for (const x of intent.tools) {
          if (x.isNew) await replayPendingInterventionsForToolCall(x.payload.id);
        }
        return;
      }

      case 'resolveToolResult': {
        enqueueMainToolResult(
          intent.toolCallId,
          intent.content,
          intent.isError,
          intent.pluginState,
        );
        const toolMsgId = toolMsgIdByCallId.get(intent.toolCallId);
        if (toolMsgId && mainToolCallIds.has(intent.toolCallId)) {
          const update: Partial<UIChatMessage> = { content: intent.content };
          if (intent.pluginState) (update as any).pluginState = intent.pluginState;
          if (intent.isError) (update as any).pluginError = { message: intent.content };
          get().internal_dispatchMessage(
            { id: toolMsgId, type: 'updateMessage', value: update },
            { operationId },
          );
        }
        return;
      }

      case 'updateToolState': {
        if (
          !mainToolCallIds.has(intent.toolCallId) ||
          completedToolStateCallIds.has(intent.toolCallId)
        ) {
          return;
        }

        const toolMsgId = toolMsgIdByCallId.get(intent.toolCallId);
        if (!toolMsgId) {
          console.warn(
            '[HeterogeneousAgent] tool_state for unknown main toolCallId:',
            intent.toolCallId,
          );
          return;
        }

        const metadata = claimToolStateSnapshot(intent.toolCallId, toolMsgId, intent.snapshotSeq);
        if (!metadata) return;

        const update: ToolMessageUpdateOperation['value'] = {
          heterogeneousToolState: {
            operationId,
            snapshotSeq: intent.snapshotSeq,
          },
          pluginState: intent.pluginState,
        };
        messageWriteBatcher.enqueueToolMessageUpdate(toolMsgId, update, messageWriteCtx, (err) => {
          console.error('[HeterogeneousAgent] Failed to persist main tool state:', err);
          if (!terminalToolMessageIds.has(toolMsgId)) {
            pendingToolFlush.set(toolMsgId, { ...pendingToolFlush.get(toolMsgId), ...update });
          }
        });
        get().internal_dispatchMessage(
          { id: toolMsgId, metadata, type: 'replaceMessagePluginState', value: intent.pluginState },
          { operationId },
        );
        return;
      }

      case 'recordUsage': {
        const update = {
          // Keep usage on the promoted top-level field so the live message UI
          // can render it immediately, before the terminal DB refresh runs.
          usage: intent.usage as ModelUsage,
          // Wholesale metadata overwrite — re-stamp the provenance the
          // createAssistant write put there.
          metadata: heteroProvenance(mainState.currentMainMessageId),
          ...(intent.model && { model: intent.model }),
          ...(intent.provider && { provider: intent.provider }),
        };
        messageWriteBatcher.enqueueUpdateMessage(
          intent.messageId,
          update,
          messageWriteCtx,
          (err) => {
            console.error('[HeterogeneousAgent] Failed to record main usage:', err);
            stashMainFlush(intent.messageId, update);
          },
        );
        // Same payload into the store so usage + model/provider render live —
        // the subagent interpreter's `recordUsage` already does this via
        // `stream.update`. Dispatching `update` verbatim keeps the store's
        // metadata identical to the row the batcher writes.
        get().internal_dispatchMessage(
          { id: intent.messageId, type: 'updateMessage', value: update as any },
          { operationId },
        );
        return;
      }

      // Terminal error: classify the raw wire data here (adapterType lives in
      // the interpreter) and route through the full error-UI routine.
      case 'setError': {
        const messageError = toHeterogeneousAgentMessageError(intent.errorData, adapterType);
        await persistTerminalError(messageError, { clearContent: intent.clearContent });
        return;
      }
    }
  };

  /**
   * Reduce one event through the shared main-agent coordinator and apply its
   * intents. The reducer returns a mix of main-scoped and (delegated)
   * subagent-scoped intents; route each by whether it carries a `threadId`
   * (subagent) so the existing `applySubagentIntent` stays untouched.
   *
   * Commit-on-success: `mainState` advances only after every intent lands. A
   * throwing intent (only subagent createThread / createMessage rethrow; main
   * intents are best-effort) skips the commit so the next event re-derives —
   * the same resilience `reduceSubagentRuns` relies on. Always invoked inside
   * `persistQueue` so reduce reads the latest committed state and ordering
   * matches arrival.
   */
  const reduceAndApplyMain = async (event: AgentStreamEvent) => {
    // Capture the CC-native session id off the stream_start stream so every
    // message persisted below carries the session it belongs to (mirrors the
    // server handler). Stable per run; the copy makes a mid-topic fork visible.
    if (event.type === 'stream_start') {
      const sid = (event.data as { sessionId?: string } | undefined)?.sessionId;
      if (typeof sid === 'string' && sid.length > 0) {
        heteroSessionId = sid;
        void persistResumeSessionId(sid, 'stream_start');
      }
    }

    const ctx: MainAgentReduceCtx = {
      agentId: context.agentId,
      newId: (kind) => (kind === 'thread' ? generateThreadId() : `msg_${createNanoId(18)()}`),
      topicId: context.topicId ?? null,
    };
    const { intents, state: next } = reduceMainAgent(mainState, event, ctx);
    try {
      for (const intent of intents) {
        if ('threadId' in intent) await applySubagentIntent(intent as SubagentIntent);
        else await applyMainIntent(intent as MainAgentIntent);
      }
    } catch (err) {
      console.error('[HeterogeneousAgent] Intent failed, run state not advanced:', err);
      return;
    }
    mainState = next;
  };

  await rehydrateClientSubagentRuns();

  try {
    // Start session (pass resumeSessionId for multi-turn --resume)
    const result = await heterogeneousAgentService.startSession({
      agentType: adapterType,
      args: buildHeteroSpawnArgs(heterogeneousProvider),
      command: heterogeneousProvider.command || getDefaultHeterogeneousCommand(adapterType),
      cwd: workingDirectory,
      env: {
        // Tell the CLI which LobeHub conversation it is running inside. The child
        // (and every subprocess it spawns, e.g. `lh`) inherits these, so a tool
        // running under the agent can attribute its output back to this topic
        // without the agent having to pass ids it can't see. User-configured env
        // wins — this is provenance, never an override the user can't escape.
        ...buildLobeHubSessionEnv({
          agentId: context.agentId,
          operationId,
          topicId: context.topicId,
        }),
        ...heterogeneousProvider.env,
      },
      resumeSessionId,
      useClaudeCodeSdk: labPreferSelectors.enableClaudeCodeSdk(useUserStore.getState()),
    });
    agentSessionId = result.sessionId;
    if (!agentSessionId) throw new Error('Agent session returned no sessionId');

    writeTopicStatus('running');

    // Register cancel hook on the operation — when the user hits Stop, the op
    // framework calls this; we SIGINT the CC process via the main-process IPC
    // so the CLI exits instead of running to completion off-screen.
    const sidForCancel = agentSessionId;
    get().onOperationCancel?.(operationId, () => {
      heterogeneousAgentService.cancelSession(sidForCancel).catch(() => {});
    });

    // ─── Debug tracing (dev only) ───
    const trace: Array<{ event: AgentStreamEvent; timestamp: number }> = [];
    if (typeof window !== 'undefined') {
      (window as any).__HETERO_AGENT_TRACE = trace;
    }

    /**
     * Process a single `AgentStreamEvent` from main. As of phase 0,
     * main runs the adapter and `toStreamEvent` itself, so each IPC arrival
     * carries exactly one already-stamped `AgentStreamEvent` (no per-line
     * batch). Per-event branches still mirror the pre-Phase-0 inner loop.
     */
    const handleStreamEvent = (event: AgentStreamEvent) => {
      // Once the user cancels, drop any trailing events the CLI emits before
      // exit so they don't leak into DB writes.
      if (isAborted()) return;

      // Record for debugging
      trace.push({ event, timestamp: Date.now() });

      if (event.type === 'stream_retry') {
        get().updateOperationMetadata?.(operationId, {
          streamRetry: toStreamRetryMetadata(event, adapterType),
        });
        return;
      }

      if (get().operations?.[operationId]?.metadata?.streamRetry) {
        get().updateOperationMetadata?.(operationId, { streamRetry: undefined });
      }

      // ─── agent_intervention_request: CC AskUserQuestion needs user input ───
      // Stamp the canonical `pluginIntervention.status='pending'` on the
      // matching tool message via `optimisticUpdateMessagePlugin` — that
      // single primitive (1) writes to DB, (2) updates the in-memory
      // `dbMessagesMap` reducer, AND (3) mirrors the same intervention onto
      // the parent assistant's `tools[].intervention` so both surfaces
      // (inline tool body + bottom InterventionBar) light up immediately.
      // The Intervention component registered under
      // `BuiltinToolInterventions['claude-code'][askUserQuestion]` is
      // rendered automatically by the framework while pending; the
      // eventual `tool_result` content (formatted answer text) gets
      // overwritten via the existing `tool_result` branch below.
      // Deferred behind `persistQueue`; if the bridge event beats the stdout
      // tool_use event, cache it and replay once the tool id is registered.
      if (event.type === 'agent_intervention_request') {
        const data = event.data as AgentInterventionRequestData;
        persistQueue = persistQueue.then(async () => {
          if (await applyInterventionRequest(data)) return;

          pendingInterventionRequests.set(data.toolCallId, data);
          if (!toolMsgIdByCallId.has(data.toolCallId)) {
            console.warn(
              '[HeterogeneousAgent] deferred intervention_request for unknown toolCallId:',
              data.toolCallId,
            );
          }
        });
        return;
      }

      // ─── agent_intervention_response: bridge-side terminal state ───
      // Mirrors the bridge's terminal state onto the UI. Only acts on the
      // cases the user did NOT drive — `user_cancelled` and successful
      // submits are already optimistic-updated by `submitHeteroIntervention`
      // and arrive here as a wire echo. Timeout / session_ended are the
      // ones that would otherwise strand the form on `status: 'pending'`
      // until the owning operation gets garbage-collected (at which point
      // a Submit click would throw `Operation not found`).
      if (event.type === 'agent_intervention_response') {
        const data = event.data as AgentInterventionResponseData;
        persistQueue = persistQueue.then(async () => {
          if (await applyInterventionResponse(data)) return;
          pendingInterventionResponses.set(data.toolCallId, data);
        });
        return;
      }

      if (event.type === 'tool_start') {
        const toolCallId = (event.data as { toolCallId?: unknown } | undefined)?.toolCallId;
        if (typeof toolCallId === 'string') {
          // Keep lifecycle changes on the same FIFO as results and state so a
          // rapid result → start → state sequence cannot be observed out of order.
          persistQueue = persistQueue.then(() => {
            completedToolStateCallIds.delete(toolCallId);
          });
        }
      }

      // ─── tool_result: reducer writes the tool content + finalizes spawns ───
      // For a main tool (incl. a subagent's parent Task tool, which is
      // main-scoped) the reducer emits `resolveToolResult` → DB content write
      // via the global `toolMsgIdByCallId` map, AND delegates so a parent-spawn
      // tool_result finalizes its run (terminal assistant + thread Active). An
      // inner subagent tool_result resolves into its thread. Not forwarded —
      // the following tool_end triggers fetchAndReplaceMessages.
      if (event.type === 'tool_result') {
        sawStreamedEvent = true; // sync: partial output exists even before the queue drains
        persistQueue = persistQueue.then(() => reduceAndApplyMain(event));
        return;
      }

      // ─── step_complete with turn_metadata: per-step usage + model/provider ───
      // The reducer writes usage/model/provider onto the current step's
      // assistant (main) or the subagent's in-thread assistant (delegated).
      // `result_usage` (grand total) is ignored by the reducer. The operation
      // usage tray derives its total from these per-message usages directly
      // (OpStatusTray → calculateOperationUsageMetrics), so there is no separate
      // accumulation here. Not forwarded (bookkeeping).
      if (event.type === 'step_complete' && event.data?.phase === 'turn_metadata') {
        persistQueue = persistQueue.then(() => reduceAndApplyMain(event));
        return;
      }

      // ─── stream_start with newStep: new LLM turn ───
      // The reducer flushes the prior turn's content/reasoning/model and opens
      // a new assistant chained off the last tool message (the shared chain rule
      // incl. the `lastToolMsgIdEver` toolless-step rescue — the chain-break fix). We
      // then forward the event (carrying the new assistant id) for live UI.
      if (event.type === 'stream_start' && event.data?.newStep) {
        // Defer same-batch stream_chunk / tool events through persistQueue so the
        // handler receives stream_start FIRST — otherwise it dispatches tools to
        // the OLD assistant (orphan tool bug).
        pendingStepTransition = true;
        persistQueue = persistQueue.then(() => reduceAndApplyMain(event));
        persistQueue = persistQueue.then(() => {
          event.data.assistantMessage = { id: mainState.currentAssistantId };
          eventHandler(event);
          // Step transition complete — handler has the new assistant ID now
          pendingStepTransition = false;
        });
        return;
      }

      // ─── Defer terminal events so content writes complete first ───
      // Gateway handler's agent_runtime_end/error triggers fetchAndReplaceMessages,
      // which would read stale DB state (before we persist final content + usage).
      if (event.type === 'agent_runtime_end' || event.type === 'error') {
        deferredTerminalEvent = event;
        notifyTerminalEvent();
        return;
      }

      // tool_state is interpreted locally after the preceding tools_calling
      // intent has registered its tool row. Do not also forward it to the
      // gateway handler: that path would bootstrap-refetch while the local
      // write-behind create may still be queued.
      if (event.type === 'stream_chunk' && event.data?.chunkType === 'tool_state') {
        sawStreamedEvent = true;
        persistQueue = persistQueue.then(() => reduceAndApplyMain(event));
        return;
      }

      // ─── stream_chunk / stream_start(init): drive the reducer for DB ───
      // text/reasoning accumulation, main tool-batch persistence, subagent
      // delegation (thread create / turn boundary / tool persist / live thread
      // bucket), and the init model/provider backfill all live in the reducer.
      // Ordering is preserved by the single FIFO persistQueue. Live MAIN-scope
      // UI is still driven by the raw-event forward below (subagent events are
      // dropped from that forward).
      if (event.type === 'stream_chunk' || event.type === 'stream_start') {
        // A stream_chunk = partial output (text / reasoning / tools / subagent
        // activity). Flag it synchronously so a resume-error retry can't fire
        // before the queued reduce records it. (stream_start init carries only
        // model/provider — no output — so it doesn't count.)
        if (event.type === 'stream_chunk') sawStreamedEvent = true;
        persistQueue = persistQueue.then(() => reduceAndApplyMain(event));
      }

      // ALL subagent-tagged events are handled inline (tool_result, line
      // 1407) or routed through the per-spawn thread-scoped dispatcher
      // (stream_chunk via persistSubagent*Chunk). They must NOT reach the
      // main gateway handler, which is main-agent-only:
      //   - `stream_chunk { tools_calling }` → handler dispatches
      //     `updateMessage { tools }` onto `currentAssistantMessageId`
      //     (main), overwriting main.tools[] with subagent tools. Main's
      //     own tool_use messages then lose their tools[] pairing and
      //     render as orphans until the next fetchAndReplaceMessages.
      //   - `stream_chunk { text | reasoning }` → bleeds subagent content
      //     into the main bubble.
      //   - `tool_start` → fires `dispatchOnBeforeCall` against the MAIN
      //     context for what is actually a subagent inner tool, leaking
      //     renderer-side onBeforeCall hooks into the wrong scope.
      //   - `tool_end`  → triggers `fetchAndReplaceMessages(main)` on
      //     every subagent inner tool result. Wasted work, AND it widens
      //     the in-memory ↔ DB drift window that surfaces as orphan
      //     warnings even after the DB has settled ().
      // DB state is already correct (the subagent persist path writes to
      // the thread scope), so dropping the forward keeps in-memory state
      // aligned with DB.
      if ((event.data as any)?.subagent) {
        return;
      }

      // Forward to the unified Gateway handler.
      //
      // Events that used to drive `fetchAndReplaceMessages` on the handler side
      // (`tool_end`, `step_complete:execution_complete`) now wait only for the
      // reducer to settle local raw-message SoT, then tell the handler to skip
      // the DB fetch. This keeps parallel tool batches from being overwritten by
      // a stale DB snapshot while write-behind batchMutate drains independently.
      // `stream_chunk` with server-attached `toolMessageIds` still fetches: that
      // path means the server created rows the client does not have locally.
      //
      // Other forwards (text / reasoning / tools_calling dispatches) stay
      // synchronous so live streaming UX isn't gated on DB round-trips.
      attachInitialAssistantSeed(event);
      const hasFrontendSotReconciliation =
        event.type === 'tool_end' ||
        (event.type === 'step_complete' &&
          (event.data as { phase?: string } | undefined)?.phase === 'execution_complete');
      const triggersFetchAndReplace =
        hasFrontendSotReconciliation ||
        (event.type === 'stream_chunk' &&
          (event.data as { toolMessageIds?: unknown } | undefined)?.toolMessageIds !== undefined);

      if (pendingStepTransition || triggersFetchAndReplace) {
        persistQueue = persistQueue.then(async () => {
          if (hasFrontendSotReconciliation) {
            markSkipMessageFetch(event);
          } else if (triggersFetchAndReplace) {
            await messageWriteBatcher.flush('before-fetch-replace');
          }
          eventHandler(event);
        });
      } else {
        eventHandler(event);
      }
    };

    unsubscribe = subscribeBroadcasts(agentSessionId, {
      onStreamEvent: handleStreamEvent,

      onComplete: () => {
        void runCompletionCallback(async () => {
          if (completed) return;
          completed = true;

          if (!isAborted() && !deferredTerminalEvent) {
            await waitForTerminalEvent(HETERO_TERMINAL_EVENT_GRACE_TIMEOUT_MS);
          }

          const isErrorTerminal = deferredTerminalEvent?.type === 'error';

          // Reset the sidebar "running" status BEFORE awaiting the persist queue.
          // Topic status is independent of message persistence, so a stalled queue
          // (e.g. a subagent-heavy run whose final DB write never settles) must not
          // strand the topic spinning after the CLI has exited — the stuck-spinner
          // this guards against. Content persistence + the terminal forward still
          // wait for queued reducer state so terminal never flushes stale content.
          {
            const reason = (deferredTerminalEvent?.data as { reason?: string } | undefined)?.reason;
            if (isErrorTerminal) {
              writeTopicStatus('failed');
            } else if (!isAborted() && isCompletedRuntimeEnd(reason)) {
              // Clean completion: the viewer sees 'active'; a background topic gets
              // the unread badge (markTopicUnread self-guards on activeTopicId).
              if (get().activeTopicId === context.topicId) writeTopicStatus('active');
              else
                get().markTopicUnread?.({
                  agentId: context.agentId,
                  groupId: context.groupId,
                  topicId: context.topicId,
                });
            } else {
              // Cancel / deferred-tool park — back to a neutral 'active'.
              writeTopicStatus('active');
            }
          }

          const terminalEvent: AgentStreamEvent = deferredTerminalEvent ?? {
            data: {},
            operationId,
            stepIndex: 0,
            timestamp: Date.now(),
            type: 'agent_runtime_end',
          };
          let finalContent = '';

          // Reduce the terminal event through the shared coordinator: it flushes
          // the last step's content/reasoning/model (with echo suppression), and
          // — for an error terminal — emits `setError` → `persistTerminalError`
          // (full error UI). It also drains any subagent run that never saw its
          // parent tool_result (CLI crashed mid-subagent, or the spawn's
          // tool_result arrived after the stream closed), flushing each run's
          // trailing content and marking the thread Active. Queue this terminal
          // reduce behind every prior stream event: content chunks are live-UI
          // only until the reducer accumulates them, so a timeout-based drain
          // would let terminal flush read a stale `mainState`.
          persistQueue = persistQueue.then(async () => {
            // Snapshot the final content BEFORE terminal reduce resets the
            // accumulator — used for the completion notification body below.
            finalContent = mainState.accContent;
            await reduceAndApplyMain(terminalEvent);
            await messageWriteBatcher.flush('terminal');
          });
          const queueDrained = await waitForPersistQueue(persistQueue, 'terminal');

          if (queueDrained) {
            // Order is load-bearing: rows first, in the order they were enqueued
            // (that is their FK dependency order), then the content patches —
            // an update against a row that does not exist yet matches zero rows.
            await pendingCreateLedger.drain();

            for (const [messageId, update] of pendingMainFlush) {
              try {
                await updateMessageOrThrow(messageId, update);
                pendingMainFlush.delete(messageId);
              } catch (err) {
                console.error('[HeterogeneousAgent] Failed to replay main assistant flush:', err);
              }
            }

            for (const [messageId, update] of pendingToolFlush) {
              try {
                const result = await messageService.updateToolMessage(messageId, update, {
                  agentId: context.agentId,
                  topicId: context.topicId,
                });
                if (result?.success === false) {
                  throw new Error(`updateToolMessage returned success=false for ${messageId}`);
                }
                pendingToolFlush.delete(messageId);
              } catch (err) {
                console.error('[HeterogeneousAgent] Failed to replay tool flush:', err);
              }
            }

            // Replay any subagent flush that failed transiently mid-stream, pinned
            // to its original in-thread assistant (NOT the terminal row).
            for (const [threadId, pending] of pendingSubagentFlush) {
              const update: Record<string, any> = {};
              if (pending.content) update.content = pending.content;
              if (pending.reasoning) update.reasoning = { content: pending.reasoning };
              if (Object.keys(update).length === 0) continue;
              try {
                await messageService.updateMessage(pending.messageId, update, {
                  agentId: context.agentId,
                  topicId: context.topicId,
                });
                subagentThreads.get(threadId)?.stream.update(pending.messageId, update);
              } catch (err) {
                console.error('[HeterogeneousAgent] Failed to replay subagent flush:', err);
              }
            }
            pendingSubagentFlush.clear();
          }

          if (!isErrorTerminal) {
            // Topic status was already reset ahead of the queue (top of
            // onComplete); forward the deferred terminal with the current
            // frontend SoT so the handler can complete the operation without a
            // DB refresh that may race write-behind batchMutate.
            attachTerminalFrontendSnapshot(terminalEvent);
            eventHandler(terminalEvent);
            if (!queueDrained) get().completeOperation(operationId);
          }

          // Signal completion to the user — dock badge + (window-hidden) notification,
          // delegated to the shared `afterRunComplete` hook. It does the same
          // showNotification + setBadgeCount fan-out for non-client runtimes. We pass
          // the in-memory accumulated content (the store snapshot isn't durable yet);
          // the shared helper strips markdown + caps length + resolves the title.
          // Skip for aborted runs and for error terminations.
          if (!isAborted() && !isErrorTerminal) {
            await runLifecycle.afterRunComplete({
              context,
              notification: { content: finalContent },
              operationId,
              runId: operationId,
              runScope,
              runtimeType: 'hetero',
            });
          }
        });
      },

      onError: (error) => {
        void runCompletionCallback(async () => {
          if (completed) return;
          if (retryWithoutResume(error)) return;
          completed = true;

          // Reset status ahead of the queue (see onComplete) so a stalled queue
          // can't strand the spinner; persistTerminalError below re-asserts 'failed'
          // with the full error UI.
          writeTopicStatus(isAborted() ? 'active' : 'failed');

          const deferredMessageError =
            deferredTerminalEvent?.type === 'error'
              ? toHeterogeneousAgentMessageError(deferredTerminalEvent.data, adapterType)
              : undefined;
          const messageError =
            deferredMessageError || toHeterogeneousAgentMessageError(error, adapterType);
          let shouldClearTerminalErrorContent = false;

          persistQueue = persistQueue.then(async () => {
            shouldClearTerminalErrorContent = shouldSuppressTerminalErrorEcho(
              mainState.accContent,
              messageError,
            );

            if (mainState.accContent && !shouldClearTerminalErrorContent) {
              messageWriteBatcher.enqueueUpdateMessage(
                mainState.currentAssistantId,
                { content: mainState.accContent },
                messageWriteCtx,
                console.error,
              );
            }
            await messageWriteBatcher.flush('error');
          });
          await waitForPersistQueue(persistQueue, 'error');

          // If the error came from a user-initiated cancel (SIGINT → non-zero
          // exit), don't surface it as a runtime error toast — the operation is
          // already marked cancelled and the partial content is persisted above.
          if (isAborted()) {
            writeTopicStatus('active');
            return;
          }

          await persistTerminalError(messageError, {
            clearContent: shouldClearTerminalErrorContent,
          });
        });
      },
    });

    const systemContext = buildLocalHeterogeneousSystemContext({
      agentSystemContext: heterogeneousProvider.systemContext,
      contextSelections,
      pageSelections,
      workingDirectory,
    });

    // Send the prompt — blocks until process exits
    await heterogeneousAgentService.sendPrompt({
      agentId: context.agentId,
      imageList,
      operationId,
      prompt: message,
      sessionId: agentSessionId,
      systemContext: systemContext || undefined,
      topicId: context.topicId ?? undefined,
    });
    await waitForCompletionCallback();

    // Persist heterogeneous-agent session id + the cwd it was created under,
    // for multi-turn resume. CC stores sessions per-cwd
    // (`~/.claude/projects/<encoded-cwd>/`), so the next turn must verify the
    // cwd hasn't changed before `--resume`. Reuses `workingDirectory` as the
    // topic-level binding — pinning the topic to this cwd once the agent has
    // executed here.
    //
    // Source of truth shifted from renderer's adapter to main's pipeline as of
    // phase 0; pull it back through the existing `getSessionInfo`
    // IPC, which already returns the freshest `agentSessionId` main has
    // mirrored from `pipeline.sessionId`.
    const sessionInfo = await heterogeneousAgentService
      .getSessionInfo(agentSessionId)
      .catch(() => undefined);
    if (sessionInfo?.agentSessionId && context.topicId) {
      // Best-effort: a rejected metadata save must NOT throw past the queue
      // drain below — guarding the await here keeps the resume-id persistence
      // from blocking the follow-up send. The same helper is also triggered as
      // soon as stream_start reports a session id, so non-zero CLI exits still
      // preserve resume context; this success-path await only ensures queued
      // follow-up sends read the just-finished id.
      await persistResumeSessionId(sessionInfo.agentSessionId, 'success-path');
    }

    // ━━━ Drain queued messages after a successful CC turn ━━━
    // Mirrors the client-mode drain in streamingExecutor.ts. With Plan A we
    // don't extend CC's stdin lifetime — a follow-up message just spawns a
    // new `claude` (with --resume via topic metadata) once the current run
    // exits. Must run AFTER the `updateTopicMetadata` await above so the next
    // sendMessage's `resolveHeteroResume` reads the just-finished session id
    // instead of starting a fresh CLI session and breaking turn-to-turn
    // continuity. Skip on abort/error so a manual stop preserves the queue
    // for the user to manage via QueueTray; "send now" = stop + send.
    // Cast: TS narrows the closure-mutated `deferredTerminalEvent` back to
    // `null` in linear flow (it can't see writes from the async IPC handler).
    const terminalEvent = deferredTerminalEvent as AgentStreamEvent | null;
    if (!isAborted() && terminalEvent?.type !== 'error') {
      const contextKey = messageMapKey(context);
      const remainingQueued = get().drainQueuedMessages?.(contextKey) ?? [];
      if (remainingQueued.length > 0) {
        // Force-complete this op + mark unread BEFORE the next sendMessage,
        // otherwise its queue check (covering all AI_RUNTIME_OPERATION_TYPES)
        // would still see this op as "running" and re-queue the merged content
        // into a now-orphaned operation.
        get().completeOperation(operationId);
        const completedOp = get().operations?.[operationId];
        if (completedOp?.context.agentId) {
          get().markTopicUnread?.({
            agentId: completedOp.context.agentId,
            groupId: completedOp.context.groupId,
            topicId: completedOp.context.topicId,
          });
        }

        const merged = mergeQueuedMessages(remainingQueued);
        const mergedFiles =
          merged.filesPreview.length > 0
            ? reconstructUploadFilesFromQueue(merged.filesPreview)
            : merged.files.length > 0
              ? (merged.files.map((id) => ({ id })) as any)
              : undefined;

        setTimeout(() => {
          useChatStore
            .getState()
            .sendMessage({
              context: { ...context },
              editorData: merged.editorData,
              files: mergedFiles,
              ...(merged.forceRuntime ? { forceRuntime: merged.forceRuntime } : {}),
              message: merged.content,
              metadata: merged.metadata,
            })
            .catch((e: unknown) => {
              console.error(
                '[heterogeneousAgentExecutor] sendMessage for queued content failed:',
                e,
              );
            });
        }, 100);
      }
    }
  } catch (error) {
    if (!completed) {
      if (retryWithoutResume(error)) {
        await fallbackPromise;
        return;
      }
      completed = true;
      // `sendPrompt` rejects when the CLI exits non-zero, which is how SIGINT
      // lands here too. If the user cancelled, don't surface an error.
      if (isAborted()) {
        writeTopicStatus('active');
        return;
      }
      const messageError = toHeterogeneousAgentMessageError(error, adapterType);
      await persistTerminalError(messageError, {
        clearContent: shouldSuppressTerminalErrorEcho(mainState.accContent, messageError),
      });
    }
  } finally {
    await waitForCompletionCallback();
    unsubscribe?.();
    // Don't stopSession here — keep it alive for multi-turn resume.
    // Session cleanup happens on topic deletion or Electron quit.

    // Backstop: if neither onComplete nor onError ever ran (e.g. the
    // heteroAgentSessionComplete IPC was missed, or its listener was torn down
    // before it landed), the status reset above never happened. The CLI has
    // exited by the time this linear path resolves, so a topic still persisted
    // as 'running' would spin forever — reconcile it. Both terminal callbacks
    // reset status ahead of their queue wait, so reaching here still 'running' means
    // neither ran. Skipped on the resume-retry path, whose recursive run owns
    // the lifecycle.
    if (!resumeFallbackTriggered && context.topicId) {
      // Best-effort: a finally must never throw (it would mask the real flow),
      // and the topic map may be absent in edge/test states.
      try {
        const stuckRunning =
          topicSelectors.getTopicById(context.topicId)(get())?.status === 'running';
        if (stuckRunning) {
          // Cast: TS narrows the closure-mutated `deferredTerminalEvent` back to
          // `null` in this linear-flow scope (it can't see the async IPC writes).
          const terminal = deferredTerminalEvent as AgentStreamEvent | null;
          writeTopicStatus(terminal?.type === 'error' ? 'failed' : 'active');
          get().completeOperation(operationId);
        }
      } catch (err) {
        console.error('[HeterogeneousAgent] status reconcile backstop failed:', err);
      }
    }
  }

  if (fallbackPromise) {
    await fallbackPromise;
  }
};
