import type {
  AgentInterventionRequestData,
  AgentInterventionResponseData,
  AgentStreamEvent,
} from '@lobechat/agent-gateway-client';
import { isDesktop } from '@lobechat/const';
import {
  CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
  CODEX_CLI_INSTALL_DOCS_URL,
  type HeterogeneousAgentSessionError,
  HeterogeneousAgentSessionErrorCode,
} from '@lobechat/electron-client-ipc';
import {
  createSubagentRunsState,
  reduceSubagentRuns,
  type SubagentEventContext,
  type SubagentIntent,
  type SubagentReduceCtx,
  type SubagentRunsState,
  type ToolCallPayload,
} from '@lobechat/heterogeneous-agents';
import type {
  ChatMessageError,
  ChatToolPayload,
  ChatTopicStatus,
  ConversationContext,
  HeterogeneousProviderConfig,
  MessageMapScope,
  UIChatMessage,
} from '@lobechat/types';
import { AgentRuntimeErrorType, ThreadStatus, ThreadType } from '@lobechat/types';
import { createNanoId } from '@lobechat/utils';
import { t } from 'i18next';

import { message as antdMessage } from '@/components/AntdStaticMethods';
import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { messageService } from '@/services/message';
import { threadService } from '@/services/thread';
import { type ChatStore, useChatStore } from '@/store/chat/store';
import { resolveNotificationNavigatePath } from '@/store/chat/utils/desktopNotification';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { messageMapKey } from '../../../utils/messageMapKey';
import { mergeQueuedMessages } from '../../operation/types';
import { createGatewayEventHandler } from './gatewayEventHandler';

/** Mirrors `idGenerator('threads', 16)` on the server so sync-allocated ids have the same shape. */
const generateThreadId = () => `thd_${createNanoId(16)()}`;

/**
 * Fire desktop notification + dock badge when a CC/Codex/ACP run finishes.
 * Notification only shows when the window is hidden (enforced in main); the
 * badge is always set so a minimized/backgrounded app still signals completion.
 */
const notifyCompletion = async (title: string, body: string, context: ConversationContext) => {
  if (!isDesktop) return;
  try {
    const { desktopNotificationService } = await import('@/services/electron/desktopNotification');
    const navigatePath = resolveNotificationNavigatePath({
      agentId: context.agentId,
      groupId: context.groupId,
      topicId: context.topicId,
    });
    await Promise.allSettled([
      desktopNotificationService.showNotification({
        body,
        navigate: navigatePath ? { path: navigatePath } : undefined,
        title,
      }),
      desktopNotificationService.setBadgeCount(1),
    ]);
  } catch (error) {
    console.error('[HeterogeneousAgent] Desktop notification failed:', error);
  }
};

const CLI_AUTH_REQUIRED_PATTERNS = [
  /failed to authenticate/i,
  /invalid authentication credentials/i,
  /authentication[_ ]error/i,
  /not authenticated/i,
  /\bunauthorized\b/i,
  /\b401\b/,
] as const;

const buildCliAuthRequiredSessionError = (
  agentType: 'claude-code' | 'codex',
  rawMessage: string,
): HeterogeneousAgentSessionError => ({
  agentType,
  code: HeterogeneousAgentSessionErrorCode.AuthRequired,
  docsUrl:
    agentType === 'claude-code' ? CLAUDE_CODE_CLI_INSTALL_DOCS_URL : CODEX_CLI_INSTALL_DOCS_URL,
  message:
    agentType === 'claude-code'
      ? 'Claude Code could not authenticate. Sign in again or refresh its credentials, then retry.'
      : 'Codex could not authenticate. Sign in again or refresh its credentials, then retry.',
  stderr: rawMessage,
});

const normalizeErrorText = (value?: string) => value?.replaceAll(/\s+/g, ' ').trim();

const maybeClassifyCliAuthRequiredError = (
  error: unknown,
  agentType?: string,
): HeterogeneousAgentSessionError | undefined => {
  if (agentType !== 'claude-code' && agentType !== 'codex') return;

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

  if (!message || !CLI_AUTH_REQUIRED_PATTERNS.some((pattern) => pattern.test(message))) return;

  return buildCliAuthRequiredSessionError(agentType, message);
};

const shouldSuppressTerminalErrorEcho = (content: string, error: ChatMessageError): boolean => {
  const errorBody = error.body as
    | (HeterogeneousAgentSessionError & { clearEchoedContent?: boolean })
    | undefined;
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

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Agent execution failed';

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
  heterogeneousProvider: HeterogeneousProviderConfig;
  /** Image attachments from user message — passed to Main for vision support */
  imageList?: Array<{ id: string; url: string }>;
  message: string;
  operationId: string;
  /** CC session ID from previous execution in this topic (for --resume) */
  resumeSessionId?: string;
  workingDirectory?: string;
}

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
 * Per-assistant-message persistence state — covers ONE assistant row's
 * `tools[]` JSONB and the de-dupe set for its tool_uses. Main-agent
 * and subagent-thread assistants each have their own instance; the
 * `tool_use.id → tool message DB id` lookup is SHARED globally across
 * all scopes (see `toolMsgIdByCallId` in `executeHeterogeneousAgent`)
 * because `tool_result` events identify the target by id alone.
 */
interface ToolPersistenceState {
  /** Ordered list of ChatToolPayload[] written to this assistant's tools JSONB */
  payloads: ChatToolPayload[];
  /** Set of tool_use.id that have been persisted (de-dupe guard) */
  persistedIds: Set<string>;
}

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
  /** Update a message already in the thread bucket by id. */
  update: (id: string, value: Partial<UIChatMessage>) => void;
}

/**
 * Runs the 3-phase tool persistence flow for ONE assistant message —
 * either the main-agent assistant or a subagent-thread-scoped assistant.
 * Same ordering guarantee in both scopes:
 *
 *   1. Pre-register tools[] on the assistant (no result_msg_id yet), so
 *      LobeHub's conversation-flow parser finds matching ids the moment
 *      tool messages land in DB — no orphan window.
 *   2. Create `role:'tool'` messages, one per fresh tool_use. `threadId`
 *      is only set for subagent scope (so the tool messages stay inside
 *      the subagent Thread and don't leak into the main topic).
 *   3. Re-write assistant.tools[] with the backfilled `result_msg_id`
 *      so the UI can hydrate tool results.
 *
 * Carries the latest accumulated text/reasoning into Phases 1+3 so DB
 * stays in sync with streamed content. Without this, the gateway
 * handler's `tool_end → fetchAndReplaceMessages` would read a
 * tools-only row and clobber in-memory streamed text in the UI.
 *
 * Idempotent against re-processing: tool_use ids already in
 * `state.persistedIds` are skipped.
 */
const persistToolBatch = async (
  incoming: ToolCallPayload[],
  state: ToolPersistenceState,
  assistantMessageId: string,
  context: ConversationContext,
  snapshot: { content: string; reasoning: string },
  /**
   * Global `tool_use.id → tool message DB id` map, populated by every
   * call (main + every subagent run) so a later `tool_result` lookup
   * finds its row without needing to know which scope created it.
   */
  toolMsgIdByCallId: Map<string, string>,
  /**
   * When set, tool messages are scoped to this thread (subagent mode) and
   * Phase 1 / 3 target the subagent-thread assistant. Undefined = main
   * agent scope (tools live under the main topic, threadId stays null).
   */
  threadId?: string,
  /**
   * Invoked immediately after each fresh tool's `role:'tool'` DB row is
   * created, with the DB-generated id + the payload. Subagent callers
   * use this to seed the thread's messagesMap bucket so the UI shows
   * the tool bubble in sync with the DB row; main-agent callers leave
   * it undefined (fetchAndReplaceMessages hydrates the main bucket).
   */
  onToolCreated?: (args: {
    assistantMessageId: string;
    toolMessageId: string;
    tool: ToolCallPayload;
  }) => void,
) => {
  const freshTools = incoming.filter((t) => !state.persistedIds.has(t.id));
  if (freshTools.length === 0) return;

  // Mark all fresh tools as persisted up front, so re-entrant calls (from
  // Claude Code echoing tool_use blocks) are safely deduped.
  for (const tool of freshTools) state.persistedIds.add(tool.id);

  const buildUpdate = (): Record<string, any> => {
    const update: Record<string, any> = { tools: state.payloads };
    if (snapshot.content) update.content = snapshot.content;
    if (snapshot.reasoning) update.reasoning = { content: snapshot.reasoning };
    return update;
  };

  // ─── PHASE 1: pre-register tools[] on the assistant row ───
  for (const tool of freshTools) state.payloads.push({ ...tool } as ChatToolPayload);
  try {
    await messageService.updateMessage(assistantMessageId, buildUpdate(), {
      agentId: context.agentId,
      topicId: context.topicId,
    });
  } catch (err) {
    console.error('[HeterogeneousAgent] Failed to pre-register assistant tools:', err);
  }

  // ─── PHASE 2: create the tool messages ───
  for (const tool of freshTools) {
    try {
      const result = await messageService.createMessage({
        agentId: context.agentId,
        content: '',
        parentId: assistantMessageId,
        plugin: {
          apiName: tool.apiName,
          arguments: tool.arguments,
          identifier: tool.identifier,
          type: tool.type as ChatToolPayload['type'],
        },
        role: 'tool',
        threadId,
        tool_call_id: tool.id,
        topicId: context.topicId ?? undefined,
      });
      toolMsgIdByCallId.set(tool.id, result.id);
      const entry = state.payloads.find((p) => p.id === tool.id);
      if (entry) entry.result_msg_id = result.id;
      onToolCreated?.({ assistantMessageId, toolMessageId: result.id, tool });
    } catch (err) {
      console.error('[HeterogeneousAgent] Failed to create tool message:', err);
    }
  }

  // ─── PHASE 3: backfill result_msg_id on assistant.tools[] ───
  try {
    await messageService.updateMessage(assistantMessageId, buildUpdate(), {
      agentId: context.agentId,
      topicId: context.topicId,
    });
  } catch (err) {
    console.error('[HeterogeneousAgent] Failed to finalize assistant tools:', err);
  }
};

/**
 * Update a tool message's content in DB when tool_result arrives.
 *
 * `pluginState` (when provided by the adapter) is written in the same request
 * as `content` so downstream consumers observe a single atomic update —
 * critical for `selectTodosFromMessages` which reads both role=tool and
 * `pluginState.todos` in one pass.
 */
const persistToolResult = async (
  toolCallId: string,
  content: string,
  isError: boolean,
  toolMsgIdByCallId: Map<string, string>,
  context: ConversationContext,
  pluginState?: Record<string, any>,
) => {
  const toolMsgId = toolMsgIdByCallId.get(toolCallId);
  if (!toolMsgId) {
    console.warn('[HeterogeneousAgent] tool_result for unknown toolCallId:', toolCallId);
    return;
  }

  try {
    await messageService.updateToolMessage(
      toolMsgId,
      {
        content,
        pluginError: isError ? { message: content } : undefined,
        pluginState,
      },
      {
        agentId: context.agentId,
        topicId: context.topicId,
      },
    );
  } catch (err) {
    console.error('[HeterogeneousAgent] Failed to update tool message content:', err);
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
    assistantMessageId,
    context,
    imageList,
    message,
    operationId,
    resumeSessionId,
    workingDirectory,
  } = params;

  const adapterType = resolveAdapterType(heterogeneousProvider);

  // Create the unified event handler (same one Gateway uses)
  const eventHandler = createGatewayEventHandler(get, {
    assistantMessageId,
    context,
    operationId,
  });
  const persistTerminalError = async (
    messageError: ChatMessageError,
    options?: { clearContent?: boolean },
  ) => {
    writeTopicStatus('failed');
    get().internal_toggleToolCallingStreaming(currentAssistantMessageId, undefined);
    get().completeOperation(operationId);

    if (options?.clearContent) {
      await messageService
        .updateMessage(
          currentAssistantMessageId,
          { content: '' },
          {
            agentId: context.agentId,
            topicId: context.topicId,
          },
        )
        .catch(console.error);
    }

    const updateResult = await messageService
      .updateMessageError(currentAssistantMessageId, messageError, {
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
        id: currentAssistantMessageId,
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

  // Track state for DB persistence (main-agent scope)
  const toolState: ToolPersistenceState = {
    payloads: [],
    persistedIds: new Set(),
  };
  /**
   * Global `tool_use.id → tool message DB id` lookup, shared across the
   * main agent and every subagent run. `tool_result` events identify
   * the target row by `toolCallId` alone (no scope context needed), so
   * one flat map keeps the lookup trivial. Populated by every
   * `persistToolBatch` call.
   */
  const toolMsgIdByCallId: Map<string, string> = new Map();
  /**
   * Shared subagent run coordinator state (the pure reducer in
   * `@lobechat/heterogeneous-agents`). Holds the run map keyed by the
   * main-agent Task tool_use id; the renderer interpreter
   * (`applySubagentIntent`) maps the reducer's intents onto DB writes +
   * live thread-bucket dispatch. Reassigned (commit-on-success) by
   * `reduceAndApplySubagent`. Lives at executor scope because a subagent
   * spawn can emit events before and after a main-agent step cut.
   */
  let subagentState: SubagentRunsState = createSubagentRunsState();
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
  /** Serializes async persist operations so ordering is stable. */
  let persistQueue: Promise<void> = Promise.resolve();
  /** Tracks the current assistant message being written to (switches on new steps) */
  let currentAssistantMessageId = assistantMessageId;
  /** Content accumulators — reset on each new step */
  let accumulatedContent = '';
  let accumulatedReasoning = '';
  /** Latest model string — updated per turn, written alongside content on step boundaries. */
  let lastModel: string | undefined;
  /** Adapter/CLI provider (e.g. `claude-code`) — carried on every turn_metadata. */
  let lastProvider: string | undefined;
  /**
   * Most recent tool `result_msg_id` seen across step boundaries — survives the
   * `toolState.payloads` reset that happens on every new step.
   *
   * Required for the **toolless middle step** case (): when a step
   * produces only text (e.g. Monitor stdout drives Claude to reply "wait a moment…"
   * without invoking a tool), `toolState.payloads` is empty at the next step
   * boundary. Without this tracker, `stepParentId` would fall back to
   * `currentAssistantMessageId` (= the toolless assistant), forming an
   * `assistant → assistant` link. `MessageCollector.collectAssistantChain`
   * only walks the `assistant → tool → assistant` zigzag, so the UI splits
   * into one bubble per Monitor stdout line.
   *
   * Scope: executor lifetime (one user run). A new user message spawns a
   * new executor, so this resets implicitly at run boundaries.
   */
  let lastToolMsgIdEver: string | undefined;
  /**
   * Deferred terminal event (agent_runtime_end or error). We don't forward
   * these to the gateway handler immediately because handler triggers
   * fetchAndReplaceMessages which would clobber our in-flight content
   * writes with stale DB state. onComplete forwards after persistence.
   */
  let deferredTerminalEvent: AgentStreamEvent | null = null;
  /**
   * True while a step transition is in flight (stream_start queued but not yet
   * forwarded to handler). Events that would normally be forwarded sync must
   * be deferred through persistQueue so the handler receives stream_start first.
   * Without this, tools_calling gets dispatched to the OLD assistant → orphan.
   */
  let pendingStepTransition = false;

  // Subscribe to the operation's abort signal so we can drop late events and
  // stop writing to DB the moment the user clicks Stop. If the op is gone
  // (cleaned up already) or missing in a test stub, treat as not-aborted.
  const abortSignal = get().operations?.[operationId]?.abortController?.signal;
  const isAborted = () => !!abortSignal?.aborted;
  const updateTopicMetadata = get().updateTopicMetadata;
  const hasStreamedState = () =>
    !!accumulatedContent ||
    !!accumulatedReasoning ||
    toolState.payloads.length > 0 ||
    toolMsgIdByCallId.size > 0 ||
    subagentState.runs.size > 0;
  const clearStaleResumeMetadata = async () => {
    if (!context.topicId || !updateTopicMetadata) return;

    await updateTopicMetadata(context.topicId, {
      heteroSessionId: undefined,
      workingDirectory: workingDirectory ?? '',
    });
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
    switch (intent.kind) {
      case 'createThread': {
        try {
          await threadService.createThread({
            id: intent.threadId,
            metadata: {
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
          // Rethrow so `reduceAndApplySubagent` skips the state commit — the
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
        const t = subagentThreads.get(intent.threadId);
        const msg = {
          agentId: intent.agentId ?? undefined,
          content: intent.content,
          id: intent.messageId,
          parentId: intent.parentId,
          role: intent.role,
          threadId: intent.threadId,
          topicId: context.topicId,
        };
        try {
          await messageService.createMessage(msg);
        } catch (err) {
          // Rethrow so `reduceAndApplySubagent` skips the state commit — the
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
        const t = subagentThreads.get(intent.threadId);
        const value: Partial<UIChatMessage> = {};
        if (intent.content !== undefined) value.content = intent.content;
        if (intent.reasoning !== undefined)
          (value as any).reasoning = { content: intent.reasoning };
        t?.stream.update(intent.messageId, value);
        return;
      }

      case 'persistContent': {
        const t = subagentThreads.get(intent.threadId);
        const update: Record<string, any> = {};
        if (intent.content) update.content = intent.content;
        if (intent.reasoning) update.reasoning = { content: intent.reasoning };
        if (Object.keys(update).length === 0) return;
        try {
          await messageService.updateMessage(intent.messageId, update, {
            agentId: context.agentId,
            topicId: context.topicId,
          });
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
        const t = subagentThreads.get(intent.threadId);
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

        // Phase 1: pre-register assistant.tools[] (no result_msg_id yet).
        try {
          await messageService.updateMessage(intent.assistantMessageId, buildUpdate(false), {
            agentId: context.agentId,
            topicId: context.topicId,
          });
        } catch (err) {
          console.error('[HeterogeneousAgent] Failed to pre-register subagent tools:', err);
        }

        // Phase 2: create rows for new tools with their pre-allocated ids,
        // register the global lookup, and seed the thread bucket bubble.
        for (const x of intent.tools) {
          if (!x.isNew) continue;
          const toolMsg = {
            agentId: context.agentId,
            content: '',
            id: x.toolMessageId,
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
          try {
            await messageService.createMessage(toolMsg);
          } catch (err) {
            console.error('[HeterogeneousAgent] Failed to create subagent tool message:', err);
            continue;
          }
          toolMsgIdByCallId.set(x.payload.id, x.toolMessageId);
          t?.stream.create(toolMsg as UIChatMessage);
        }

        // Phase 3: backfill result_msg_id on assistant.tools[].
        try {
          await messageService.updateMessage(intent.assistantMessageId, buildUpdate(true), {
            agentId: context.agentId,
            topicId: context.topicId,
          });
        } catch (err) {
          console.error('[HeterogeneousAgent] Failed to finalize subagent tools:', err);
        }

        // Surface the live assistant tools[] + content into the thread bucket.
        t?.stream.update(intent.assistantMessageId, buildUpdate(true) as Partial<UIChatMessage>);
        return;
      }

      case 'resolveToolResult': {
        const t = subagentThreads.get(intent.threadId);
        // DB write (via the global tool-message map) + live thread bucket update.
        await persistToolResult(
          intent.toolCallId,
          intent.content,
          intent.isError,
          toolMsgIdByCallId,
          context,
          intent.pluginState,
        );
        const toolMsgId = toolMsgIdByCallId.get(intent.toolCallId);
        if (toolMsgId) {
          const update: Partial<UIChatMessage> = { content: intent.content };
          if (intent.pluginState) (update as any).pluginState = intent.pluginState;
          if (intent.isError) (update as any).pluginError = { message: intent.content };
          t?.stream.update(toolMsgId, update);
        }
        return;
      }

      case 'recordUsage': {
        const t = subagentThreads.get(intent.threadId);
        const update = {
          metadata: { usage: intent.usage as any },
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
        const t = subagentThreads.get(intent.threadId);
        if (t) completeSubagentOp(t.subOperationId);
        return;
      }
    }
  };

  /**
   * Reduce one event through the shared coordinator and apply its intents.
   * `mainAssistantId` is snapshotted at event-arrival time (the spawning main
   * assistant) and threaded in as the thread/seed parent. Commit-on-success:
   * `subagentState` advances only after all intents land — a throwing create
   * intent (createThread / createMessage) skips the commit so the next event
   * re-emits the lazy create / turn boundary, while flush failures are pinned
   * in `pendingSubagentFlush` for the onComplete replay (subsumes the old
   * `pendingFlushTarget`). Always invoked inside `persistQueue` so reduce reads
   * the latest committed state and ordering matches arrival.
   */
  const reduceAndApplySubagent = async (event: AgentStreamEvent, mainAssistantId: string) => {
    // Without a topicId we can't scope a Thread — drop subagent routing
    // silently (non-topic-scoped run / test harness), matching the old guard.
    if (!context.topicId) return;
    const ctx: SubagentReduceCtx = {
      agentId: context.agentId,
      mainAssistantId,
      newId: (kind) => (kind === 'thread' ? generateThreadId() : `msg_${createNanoId(18)()}`),
      topicId: context.topicId ?? null,
    };
    const { state: next, intents } = reduceSubagentRuns(subagentState, event, ctx);
    try {
      for (const intent of intents) await applySubagentIntent(intent);
    } catch (err) {
      // An intent failed to land (e.g. transient IndexedDB / message-service
      // error on createThread / createMessage). Do NOT commit `next`: keeping
      // the prior state lets the next event re-emit the create / flush, and
      // keeps the run visible to the onComplete orphan drain. Swallow here so
      // the rejection doesn't poison the shared persistQueue chain.
      console.error('[HeterogeneousAgent] Subagent intent failed, run state not advanced:', err);
      return;
    }
    subagentState = next;
  };

  try {
    // Start session (pass resumeSessionId for multi-turn --resume)
    const result = await heterogeneousAgentService.startSession({
      agentType: adapterType,
      args: heterogeneousProvider.args,
      command: heterogeneousProvider.command || (adapterType === 'codex' ? 'codex' : 'claude'),
      cwd: workingDirectory,
      env: heterogeneousProvider.env,
      resumeSessionId,
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
      // Deferred behind `persistQueue` so it lands AFTER `persistToolBatch`
      // populates `toolMsgIdByCallId`.
      if (event.type === 'agent_intervention_request') {
        const data = event.data as AgentInterventionRequestData;
        persistQueue = persistQueue.then(async () => {
          const toolMsgId = toolMsgIdByCallId.get(data.toolCallId);
          if (!toolMsgId) {
            console.warn(
              '[HeterogeneousAgent] intervention_request for unknown toolCallId:',
              data.toolCallId,
            );
            return;
          }
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
          } catch (err) {
            console.error('[HeterogeneousAgent] persist intervention pending failed:', err);
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
        const { cancelled, cancelReason, toolCallId } = data;
        if (!cancelled) return;
        if (cancelReason === 'user_cancelled') return;
        persistQueue = persistQueue.then(async () => {
          const toolMsgId = toolMsgIdByCallId.get(toolCallId);
          if (!toolMsgId) return;
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
        });
        return;
      }

      // ─── tool_result: update tool message content in DB (ACP-only) ───
      if (event.type === 'tool_result') {
        const { content, isError, pluginState, subagent, toolCallId } = event.data as {
          content: string;
          isError?: boolean;
          pluginState?: Record<string, any>;
          subagent?: SubagentEventContext;
          toolCallId: string;
        };

        // Main tools (including a subagent's parent Task tool, which is
        // main-scoped) get their DB content written here via the global
        // `toolMsgIdByCallId` map. Subagent INNER tool_results are skipped —
        // the coordinator's `resolveToolResult` intent owns their DB write +
        // thread-bucket update (avoids a double write).
        if (!subagent) {
          persistQueue = persistQueue.then(() =>
            persistToolResult(
              toolCallId,
              content,
              !!isError,
              toolMsgIdByCallId,
              context,
              pluginState,
            ),
          );
        }

        // Route through the coordinator: an inner subagent tool_result →
        // resolveToolResult (DB + live thread bucket); a parent-spawn
        // tool_result → finalize (terminal assistant + thread Active); a plain
        // main tool_result → no intents. Queued so earlier subagent chunks in
        // the same batch have registered the run before the parent finalize
        // checks for it.
        const mainAsstId = currentAssistantMessageId;
        persistQueue = persistQueue.then(() => reduceAndApplySubagent(event, mainAsstId));

        // Don't forward — the tool_end that follows triggers fetchAndReplaceMessages
        // which reads the updated content from DB.
        return;
      }

      // ─── step_complete with turn_metadata: persist per-step usage ───
      // `turn_metadata.usage` is the per-turn delta (deduped by adapter per
      // message.id) and already normalized to the MessageMetadata.usage
      // shape — write it straight through to the current step's assistant
      // message. Queue the write so it lands after any in-flight
      // stream_start(newStep) that may still be swapping
      // `currentAssistantMessageId` to the new step's message.
      //
      // `result_usage` (grand total across all turns) is intentionally
      // ignored — applying it would overwrite the last step with the sum
      // of all prior steps. Sum of turn_metadata equals result_usage for
      // a healthy run.
      if (event.type === 'step_complete' && event.data?.phase === 'turn_metadata') {
        const turnUsage = event.data.usage;

        // Subagent-tagged usage routes through the coordinator (RecordUsage
        // intent → written onto the subagent's in-thread assistant + thread
        // bucket). It must NOT touch the MAIN agent's `lastModel` /
        // `lastProvider`, which carry main-agent step state.
        if (event.data.subagent) {
          const mainAsstId = currentAssistantMessageId;
          persistQueue = persistQueue.then(() => reduceAndApplySubagent(event, mainAsstId));
          return;
        }

        if (event.data.model) lastModel = event.data.model;
        if (event.data.provider) lastProvider = event.data.provider;
        const updateValue: Record<string, any> = {};
        if (turnUsage) updateValue.metadata = { usage: turnUsage };
        if (event.data.model) updateValue.model = event.data.model;
        if (event.data.provider) updateValue.provider = event.data.provider;

        if (Object.keys(updateValue).length > 0) {
          persistQueue = persistQueue.then(async () => {
            await messageService
              .updateMessage(currentAssistantMessageId, updateValue, {
                agentId: context.agentId,
                topicId: context.topicId,
              })
              .catch(console.error);
          });
        }
        // Don't forward turn metadata — it's internal bookkeeping
        return;
      }

      // ─── stream_start with newStep: new LLM turn, create new assistant message ───
      if (event.type === 'stream_start' && event.data?.newStep) {
        // ⚠️ Snapshot CONTENT accumulators synchronously — stream_chunk events for
        // the new step arrive in the same stream batch and would contaminate.
        // Tool state (toolMsgIdByCallId) is populated ASYNC by persistQueue, so
        // it must be read inside the queue where previous persists have completed.
        const prevContent = accumulatedContent;
        const prevReasoning = accumulatedReasoning;
        const prevModel = lastModel;
        const prevProvider = lastProvider;
        // External-signal context (): set when the adapter
        // detected a repeated tool_result on the same tool_use.id
        // (Monitor stdout push, etc.). Stamp on the new message's
        // `metadata.signal` so MessageCollector can route toolless
        // signal-tagged assistants into a SignalCallbacksNode.
        //
        // Phase 1 lives in metadata; Phase 2 () promotes to a
        // dedicated `messages.signal` column — to migrate, change THIS
        // assignment and the `getMessageSignal()` helper in
        // conversation-flow, nothing else.
        const externalSignal = event.data.externalSignal;

        // Reset content accumulators synchronously so new-step chunks go to fresh state
        accumulatedContent = '';
        accumulatedReasoning = '';

        // Mark that we're in a step transition. Events from the same stream
        // batch (stream_chunk, tool_start, etc.) must be deferred through
        // persistQueue so the handler receives stream_start FIRST — otherwise
        // it dispatches tools to the OLD assistant (orphan tool bug).
        pendingStepTransition = true;

        persistQueue = persistQueue.then(async () => {
          // Persist previous step's content to its assistant message
          const prevUpdate: Record<string, any> = {};
          if (prevContent) prevUpdate.content = prevContent;
          if (prevReasoning) prevUpdate.reasoning = { content: prevReasoning };
          if (prevModel) prevUpdate.model = prevModel;
          if (prevProvider) prevUpdate.provider = prevProvider;
          if (Object.keys(prevUpdate).length > 0) {
            await messageService
              .updateMessage(currentAssistantMessageId, prevUpdate, {
                agentId: context.agentId,
                topicId: context.topicId,
              })
              .catch(console.error);
          }

          // Create new assistant message for this step.
          // parentId should point to the last tool message from the previous step
          // (if any), forming the chain: assistant → tool → assistant → tool → ...
          // If no tool was used, fall back to the previous assistant message.
          //
          // Read from `toolState.payloads` (not the global
          // `toolMsgIdByCallId`) so we only pick up MAIN-agent tools —
          // the global map also holds subagent tool msg ids which
          // would break the main-agent step chain.
          const lastToolMsgId = [...toolState.payloads]
            .reverse()
            .find((p) => !!p.result_msg_id)?.result_msg_id;
          if (lastToolMsgId) lastToolMsgIdEver = lastToolMsgId;
          // Prefer this step's last tool, then the most recent tool ever seen
          // in the run (rescues toolless middle steps — see ), then
          // the previous assistant as a last resort.
          const stepParentId = lastToolMsgId ?? lastToolMsgIdEver ?? currentAssistantMessageId;

          const newMsg = await messageService.createMessage({
            agentId: context.agentId,
            content: '',
            ...(externalSignal ? { metadata: { signal: externalSignal } } : {}),
            model: lastModel,
            parentId: stepParentId,
            provider: lastProvider,
            role: 'assistant',
            topicId: context.topicId ?? undefined,
          });
          currentAssistantMessageId = newMsg.id;

          // Associate the new message with the operation
          get().associateMessageWithOperation(currentAssistantMessageId, operationId);

          // Reset tool state AFTER reading — new-step tool persists are queued
          // AFTER this handler, so they'll write to the clean state.
          toolState.payloads = [];
          toolState.persistedIds.clear();
          // toolMsgIdByCallId is NOT cleared — it's the global
          // id→row lookup and subagent tool_results from a previous
          // step may still land after the step boundary.
        });

        // Update the stream_start event to carry the new message ID
        // so the gateway handler can switch to it
        persistQueue = persistQueue.then(() => {
          event.data.assistantMessage = { id: currentAssistantMessageId };
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
        return;
      }

      // ─── stream_chunk: accumulate content + persist tool_use ───
      if (event.type === 'stream_chunk') {
        const chunk = event.data;

        // Subagent-scoped chunks (text / reasoning / tools_calling) route
        // through the shared coordinator — it owns thread create, turn
        // boundaries, tool persistence, and live thread-bucket streaming. Kept
        // off the main path so main-agent snapshot logic stays untouched.
        if (chunk?.subagent) {
          const mainAsstId = currentAssistantMessageId;
          persistQueue = persistQueue.then(() => reduceAndApplySubagent(event, mainAsstId));
        } else {
          if (chunk?.chunkType === 'text' && chunk.content) {
            accumulatedContent += chunk.content;
          }
          if (chunk?.chunkType === 'reasoning' && chunk.reasoning) {
            accumulatedReasoning += chunk.reasoning;
          }
          if (chunk?.chunkType === 'tools_calling') {
            const tools = chunk.toolsCalling as ToolCallPayload[];
            if (tools?.length) {
              // Snapshot accumulators sync — must travel with the same step's
              // assistantMessageId. A late-bound getter would read the NEW
              // step's content if a step transition lands between scheduling
              // and execution, while assistantMessageId would still be the OLD
              // one (also captured sync) → cross-step contamination.
              const snapshot = {
                content: accumulatedContent,
                reasoning: accumulatedReasoning,
              };
              persistQueue = persistQueue.then(() =>
                persistToolBatch(
                  tools,
                  toolState,
                  currentAssistantMessageId,
                  context,
                  snapshot,
                  toolMsgIdByCallId,
                ),
              );
            }
          }
        }
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
      // Events that drive `fetchAndReplaceMessages` on the handler side
      // (`tool_end`, `step_complete:execution_complete`, `stream_chunk` with a
      // server-attached `toolMessageIds`) must wait for `persistQueue` to drain
      // — otherwise the handler reads `assistant.tools[]` while a parallel
      // `persistToolBatch` is still mid-flight and `replaceMessages` clobbers
      // the in-memory cumulative tools[] with a shorter snapshot. That's the
      // "7 → 6 skill calls" rollback users see on parallel CC tool batches.
      //
      // Other forwards (text / reasoning / tools_calling dispatches) stay
      // synchronous so live streaming UX isn't gated on DB round-trips.
      const triggersFetchAndReplace =
        event.type === 'tool_end' ||
        (event.type === 'step_complete' &&
          (event.data as { phase?: string } | undefined)?.phase === 'execution_complete') ||
        (event.type === 'stream_chunk' &&
          (event.data as { toolMessageIds?: unknown } | undefined)?.toolMessageIds !== undefined);

      if (pendingStepTransition || triggersFetchAndReplace) {
        persistQueue = persistQueue.then(() => {
          eventHandler(event);
        });
      } else {
        eventHandler(event);
      }
    };

    unsubscribe = subscribeBroadcasts(agentSessionId, {
      onStreamEvent: handleStreamEvent,

      onComplete: async () => {
        if (completed) return;
        completed = true;

        // Wait for all tool persistence to finish before writing final state
        await persistQueue.catch(console.error);

        // Drain any subagent runs that didn't see their parent's tool_result
        // (e.g. CLI crashed mid-subagent, or CC emitted the spawn's
        // tool_result after the stream closed). The coordinator flushes each
        // run's trailing content and marks the thread Active. Drive it with a
        // synthetic terminal event so the reducer's orphan-drain path runs.
        await reduceAndApplySubagent(
          deferredTerminalEvent ?? {
            data: {},
            operationId,
            stepIndex: 0,
            timestamp: Date.now(),
            type: 'agent_runtime_end',
          },
          currentAssistantMessageId,
        ).catch(console.error);

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

        // Persist final content + reasoning + model for the last step BEFORE the
        // terminal event triggers fetchAndReplaceMessages. Usage for this step
        // was already written per-turn via the turn_metadata branch.
        const terminalMessageError =
          deferredTerminalEvent?.type === 'error'
            ? toHeterogeneousAgentMessageError(deferredTerminalEvent.data, adapterType)
            : undefined;
        const shouldClearTerminalErrorContent =
          !!terminalMessageError &&
          shouldSuppressTerminalErrorEcho(accumulatedContent, terminalMessageError);
        const updateValue: Record<string, any> = {};
        if (accumulatedContent && !shouldClearTerminalErrorContent) {
          updateValue.content = accumulatedContent;
        }
        if (accumulatedReasoning) updateValue.reasoning = { content: accumulatedReasoning };
        if (lastModel) updateValue.model = lastModel;
        if (lastProvider) updateValue.provider = lastProvider;

        if (Object.keys(updateValue).length > 0) {
          await messageService
            .updateMessage(currentAssistantMessageId, updateValue, {
              agentId: context.agentId,
              topicId: context.topicId,
            })
            .catch(console.error);
        }

        if (terminalMessageError) {
          await persistTerminalError(terminalMessageError, {
            clearContent: shouldClearTerminalErrorContent,
          });
        } else {
          writeTopicStatus('active');
          // NOW forward the deferred terminal event — handler will fetchAndReplaceMessages
          // and pick up the final persisted state.
          const terminal: AgentStreamEvent = deferredTerminalEvent ?? {
            data: {},
            operationId,
            stepIndex: 0,
            timestamp: Date.now(),
            type: 'agent_runtime_end',
          };
          eventHandler(terminal);
        }

        // Signal completion to the user — dock badge + (window-hidden) notification.
        // Skip for aborted runs and for error terminations.
        if (!isAborted() && deferredTerminalEvent?.type !== 'error') {
          const body = accumulatedContent
            ? markdownToTxt(accumulatedContent)
            : t('notification.finishChatGeneration', { ns: 'electron' });
          notifyCompletion(
            t('notification.finishChatGeneration', { ns: 'electron' }),
            body,
            context,
          );
        }
      },

      onError: async (error) => {
        if (completed) return;
        if (retryWithoutResume(error)) return;
        completed = true;

        await persistQueue.catch(console.error);

        const deferredMessageError =
          deferredTerminalEvent?.type === 'error'
            ? toHeterogeneousAgentMessageError(deferredTerminalEvent.data, adapterType)
            : undefined;
        const messageError =
          deferredMessageError || toHeterogeneousAgentMessageError(error, adapterType);
        const shouldClearTerminalErrorContent = shouldSuppressTerminalErrorEcho(
          accumulatedContent,
          messageError,
        );

        if (accumulatedContent && !shouldClearTerminalErrorContent) {
          await messageService
            .updateMessage(
              currentAssistantMessageId,
              { content: accumulatedContent },
              {
                agentId: context.agentId,
                topicId: context.topicId,
              },
            )
            .catch(console.error);
        }

        // If the error came from a user-initiated cancel (SIGINT → non-zero
        // exit), don't surface it as a runtime error toast — the operation is
        // already marked cancelled and the partial content is persisted above.
        if (isAborted()) {
          writeTopicStatus('active');
          return;
        }

        await persistTerminalError(messageError, { clearContent: shouldClearTerminalErrorContent });
      },
    });

    // Send the prompt — blocks until process exits
    await heterogeneousAgentService.sendPrompt(agentSessionId, message, operationId, imageList);

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
      await updateTopicMetadata?.(context.topicId, {
        heteroSessionId: sessionInfo.agentSessionId,
        workingDirectory: workingDirectory ?? '',
      });
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
          get().markUnreadCompleted?.(completedOp.context.agentId, completedOp.context.topicId);
        }

        const merged = mergeQueuedMessages(remainingQueued);
        const mergedFiles =
          merged.files.length > 0 ? merged.files.map((id) => ({ id }) as any) : undefined;

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
        clearContent: shouldSuppressTerminalErrorEcho(accumulatedContent, messageError),
      });
    }
  } finally {
    unsubscribe?.();
    // Don't stopSession here — keep it alive for multi-turn resume.
    // Session cleanup happens on topic deletion or Electron quit.
  }

  if (fallbackPromise) {
    await fallbackPromise;
  }
};
