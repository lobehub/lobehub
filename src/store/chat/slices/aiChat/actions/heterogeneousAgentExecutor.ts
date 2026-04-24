import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { isDesktop } from '@lobechat/const';
import {
  CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
  CODEX_CLI_INSTALL_DOCS_URL,
  type HeterogeneousAgentSessionError,
  HeterogeneousAgentSessionErrorCode,
} from '@lobechat/electron-client-ipc';
import type {
  HeterogeneousAgentEvent,
  SubagentEventContext,
  ToolCallPayload,
} from '@lobechat/heterogeneous-agents';
import { createAdapter } from '@lobechat/heterogeneous-agents';
import type {
  ChatMessageError,
  ChatToolPayload,
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
import type { ChatStore } from '@/store/chat/store';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { createGatewayEventHandler } from './gatewayEventHandler';

/** Mirrors `idGenerator('threads', 16)` on the server so sync-allocated ids have the same shape. */
const generateThreadId = () => `thd_${createNanoId(16)()}`;

/**
 * Fire desktop notification + dock badge when a CC/Codex/ACP run finishes.
 * Notification only shows when the window is hidden (enforced in main); the
 * badge is always set so a minimized/backgrounded app still signals completion.
 */
const notifyCompletion = async (title: string, body: string) => {
  if (!isDesktop) return;
  try {
    const { desktopNotificationService } = await import('@/services/electron/desktopNotification');
    await Promise.allSettled([
      desktopNotificationService.showNotification({ body, title }),
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

  return {
    body: { message },
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
 * Convert HeterogeneousAgentEvent to AgentStreamEvent (add operationId).
 */
const toStreamEvent = (event: HeterogeneousAgentEvent, operationId: string): AgentStreamEvent => ({
  data: event.data,
  operationId,
  stepIndex: event.stepIndex,
  timestamp: event.timestamp,
  type: event.type as AgentStreamEvent['type'],
});

/**
 * Subscribe to Electron IPC broadcasts for raw agent lines.
 * Returns unsubscribe function.
 */
const subscribeBroadcasts = (
  sessionId: string,
  callbacks: {
    onComplete: () => void;
    onError: (error: HeterogeneousAgentSessionError | string) => void;
    onRawLine: (line: any) => void;
  },
): (() => void) => {
  if (!window.electron?.ipcRenderer) return () => {};

  const ipc = window.electron.ipcRenderer;

  const onLine = (_e: any, data: { line: any; sessionId: string }) => {
    if (data.sessionId === sessionId) callbacks.onRawLine(data.line);
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

  ipc.on('heteroAgentRawLine' as any, onLine);
  ipc.on('heteroAgentSessionComplete' as any, onComplete);
  ipc.on('heteroAgentSessionError' as any, onError);

  return () => {
    ipc.removeListener('heteroAgentRawLine' as any, onLine);
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
 * Per-subagent-spawn state tracking the current Thread + current
 * subagent assistant message for a given parent Task tool_use. One entry
 * per `parentToolCallId`, created lazily on the first subagent event.
 *
 * `subagentMessageId` mirrors main-agent turn tracking: when the
 * adapter-reported subagent message.id changes, the executor cuts a new
 * subagent assistant message inside the Thread (same-shaped recursion
 * as the main agent's step boundary — `user → assistant → tool → assistant`).
 */
interface SubagentRunState {
  /**
   * Accumulated text content for the CURRENT in-thread assistant turn.
   * Mirrors the main agent's `accumulatedContent`: subagent text chunks
   * append while the turn streams, the value travels alongside tools[]
   * in each persist batch update so DB sees content + tools in one go,
   * and is flushed on turn change / subagent finalization.
   */
  accumulatedContent: string;
  /** Accumulated reasoning (thinking) content for the current turn. */
  accumulatedReasoning: string;
  /** The in-thread assistant message currently being appended to. */
  currentAssistantMsgId: string;
  /** Adapter's `subagentMessageId` for the current turn (change = new assistant). */
  currentSubagentMessageId: string;
  /**
   * Tools created in the most recent persist batch, keyed by tool_use.id
   * → tool message DB id. Used to chain the NEXT turn's assistant off the
   * last tool message (mirrors main agent's step-boundary parentId logic).
   * Populated after each persist from the caller-provided global map.
   */
  lastBatchToolMsgIds: string[];
  /**
   * Most recent parentId in the thread's chain. Flows like the main
   * topic: `user → assistant#1 → tool → assistant#2 → tool → ...`.
   * Updated as new tool messages / assistant messages are created so
   * the next write lands on the end of the chain.
   */
  lastChainParentId: string;
  /**
   * Run-lifetime set of every inner tool_call_id this subagent has ever
   * persisted into its thread. Unlike `state.persistedIds`, which is
   * turn-scoped and wiped when `currentSubagentMessageId` advances, this
   * set only grows — so a delayed `tool_result` that lands after the
   * owning turn has rolled over still resolves back to the right run via
   * `findRunByInnerToolCallId`. Without this, the thread-bucket
   * `updateMessage` path is skipped and the in-thread tool bubble stays
   * stuck on the loading spinner until the user re-opens the Thread
   * (main-topic `fetchAndReplaceMessages` does not rehydrate thread
   * buckets).
   */
  lifetimeToolCallIds: Set<string>;
  /**
   * Assistant message id that a deferred buffer flush is still owed to.
   * Set when `finalizeSubagentRun` captures the flush target but the DB
   * write fails; the next retry (typically the `onComplete` fallback)
   * reads this instead of the live `currentAssistantMsgId` — which the
   * subsequent terminal-message branch may have advanced to the spawn
   * result row, i.e. the WRONG target for a leftover streamed buffer.
   */
  pendingFlushTarget?: string;
  /**
   * Per-subagent-assistant persistence state (tools[] payloads +
   * dedupe). Reset on every turn boundary so each in-thread assistant
   * has its own tools[].
   */
  state: ToolPersistenceState;
  /**
   * Thread-scoped store dispatcher — mutates the thread's messagesMap
   * bucket in sync with the DB writes so the UI streams subagent text /
   * tools / results token-by-token (same UX as the main bubble). Created
   * once per spawn alongside the Thread row + the per-spawn sub-op.
   */
  stream: SubagentStoreDispatcher;
  /**
   * Per-spawn sub-operation id. Created via `startOperation` with
   * `parentOperationId` = the main run's op + `context.threadId` set, so
   * `internal_getConversationContext` resolves dispatches to the Thread
   * bucket without any threadId-override hack at the dispatch boundary.
   * Cancellation and cleanup cascade automatically via the existing
   * parent/child operation linkage.
   */
  subOperationId: string;
  /** The subagent Thread this spawn's messages belong to. */
  threadId: string;
}

/**
 * Handle a subagent `tools_calling` chunk: ensure Thread + current
 * subagent assistant exist, then run the shared 3-phase persist
 * targeting the in-thread assistant.
 *
 * Lazy Thread creation: the FIRST subagent chunk for a given parent
 * carries `spawnMetadata` (title / prompt / subagentType) on the
 * event's `subagent` peer. That's when we create the Thread row + the
 * `role:'user'` seed message. Subsequent chunks omit `spawnMetadata`
 * and just append to the existing Thread.
 *
 * Turn tracking: when `subagent.subagentMessageId` differs from the
 * stored `currentSubagentMessageId`, we cut a new in-thread assistant
 * and reset per-turn state. Chain parenting mirrors main-agent step
 * handling: `user → asst#1 → tool → asst#2 → tool → ...`.
 */
/**
 * Ensure a `SubagentRunState` exists for the given spawn + its current
 * turn matches `subagentMessageId`. Handles two lazy actions:
 *
 *   1. **First event for a new parent** → create the Thread row, seed
 *      its `role:'user'` prompt message, open the first in-thread
 *      `role:'assistant'`.
 *   2. **Turn boundary** (new `subagentMessageId`) → flush the prior
 *      turn's accumulated content to DB, then open the next in-thread
 *      assistant chained off the last tool message (same shape as
 *      main-agent step boundaries).
 *
 * Returns the run or `undefined` if any of the creates failed (the
 * caller drops the event gracefully).
 *
 * Shared by `persistSubagentToolChunk` and `persistSubagentTextChunk`
 * so text-only turns (e.g. the subagent's closing summary) and
 * tool-only turns both flow through the same Thread-lifecycle code.
 */
const ensureSubagentRun = async (
  subagentCtx: SubagentEventContext,
  mainAssistantMessageId: string,
  context: ConversationContext,
  subagentRuns: Map<string, SubagentRunState>,
  /**
   * Starts the per-spawn sub-operation (so `internal_dispatchMessage`
   * resolves into the Thread bucket via the standard operation context
   * path) and returns its id + a thread-scoped dispatcher bound to it.
   * Closed over `get` + parent `operationId` + `context` in the caller
   * so this helper doesn't need to know about the store / operation
   * registry. Called exactly once per spawn (on lazy-create) —
   * subsequent turn boundaries reuse `run.stream` + `run.subOperationId`.
   */
  beginSubagentRun: (threadId: string) => {
    stream: SubagentStoreDispatcher;
    subOperationId: string;
  },
  /**
   * Invoked once per Thread creation (the lazy-create path) so the
   * caller can invalidate SWR caches / push the new thread into any
   * in-memory list the UI is rendering. Fire-and-forget; the executor
   * shouldn't block persistence on UI-side cache refresh.
   */
  onThreadCreated?: (threadId: string) => void,
): Promise<SubagentRunState | undefined> => {
  if (!context.topicId) {
    // Without a topicId we can't create a Thread — drop silently (same
    // fallback as the main path; a non-topic-scoped test harness).
    return undefined;
  }

  let run = subagentRuns.get(subagentCtx.parentToolCallId);

  // ─── First subagent event for this parent → lazy-create Thread ───
  if (!run) {
    const { spawnMetadata } = subagentCtx;
    const threadId = generateThreadId();
    const title =
      spawnMetadata?.description?.slice(0, 80) || spawnMetadata?.subagentType || 'Subagent';

    try {
      await threadService.createThread({
        id: threadId,
        metadata: {
          sourceToolCallId: subagentCtx.parentToolCallId,
          startedAt: new Date().toISOString(),
          subagentType: spawnMetadata?.subagentType,
        },
        sourceMessageId: mainAssistantMessageId,
        status: ThreadStatus.Processing,
        title,
        topicId: context.topicId,
        type: ThreadType.Isolation,
      });
      onThreadCreated?.(threadId);
    } catch (err) {
      console.error('[HeterogeneousAgent] Failed to create subagent thread:', err);
      return undefined;
    }

    let userMsgId: string | undefined;
    try {
      const userMsg = await messageService.createMessage({
        agentId: context.agentId,
        content: spawnMetadata?.prompt ?? '',
        parentId: mainAssistantMessageId,
        role: 'user',
        threadId,
        topicId: context.topicId,
      });
      userMsgId = userMsg.id;
    } catch (err) {
      console.error('[HeterogeneousAgent] Failed to create subagent user message:', err);
      return undefined;
    }

    let firstAssistantId: string;
    try {
      const firstAssistant = await messageService.createMessage({
        agentId: context.agentId,
        content: '',
        parentId: userMsgId,
        role: 'assistant',
        threadId,
        topicId: context.topicId,
      });
      firstAssistantId = firstAssistant.id;
    } catch (err) {
      console.error('[HeterogeneousAgent] Failed to create subagent assistant message:', err);
      return undefined;
    }

    const { stream, subOperationId } = beginSubagentRun(threadId);
    // Seed the thread bucket with user + first assistant so the UI
    // renders the Thread body the moment it opens — without this the
    // thread's messagesMap entry stays empty until something triggers a
    // main-topic fetch that happens to include thread rows, leaving the
    // first subagent turn invisible.
    stream.create({
      agentId: context.agentId,
      content: spawnMetadata?.prompt ?? '',
      id: userMsgId,
      parentId: mainAssistantMessageId,
      role: 'user',
      threadId,
      topicId: context.topicId,
    } as UIChatMessage);
    stream.create({
      agentId: context.agentId,
      content: '',
      id: firstAssistantId,
      parentId: userMsgId,
      role: 'assistant',
      threadId,
      topicId: context.topicId,
    } as UIChatMessage);

    run = {
      accumulatedContent: '',
      accumulatedReasoning: '',
      currentAssistantMsgId: firstAssistantId,
      currentSubagentMessageId: subagentCtx.subagentMessageId ?? '',
      lastBatchToolMsgIds: [],
      lastChainParentId: firstAssistantId,
      lifetimeToolCallIds: new Set(),
      state: { payloads: [], persistedIds: new Set() },
      stream,
      subOperationId,
      threadId,
    };
    subagentRuns.set(subagentCtx.parentToolCallId, run);
    return run;
  }

  // ─── New subagent turn → flush old content, cut a new assistant ───
  if (
    subagentCtx.subagentMessageId &&
    subagentCtx.subagentMessageId !== run.currentSubagentMessageId
  ) {
    // Flush accumulated content for the PRIOR turn before it loses its
    // assistant reference. We rely on persistToolBatch to also keep
    // content+tools in sync during the turn, but a turn with NO tool
    // calls (e.g. the subagent's final text-only summary) would never
    // hit that path otherwise.
    if (run.accumulatedContent || run.accumulatedReasoning) {
      try {
        const update: Record<string, any> = {};
        if (run.accumulatedContent) update.content = run.accumulatedContent;
        if (run.accumulatedReasoning) update.reasoning = { content: run.accumulatedReasoning };
        await messageService.updateMessage(run.currentAssistantMsgId, update, {
          agentId: context.agentId,
          topicId: context.topicId,
        });
        run.stream.update(run.currentAssistantMsgId, update);
      } catch (err) {
        console.error('[HeterogeneousAgent] Failed to flush subagent turn content:', err);
      }
    }
    try {
      const nextAssistant = await messageService.createMessage({
        agentId: context.agentId,
        content: '',
        parentId: run.lastChainParentId,
        role: 'assistant',
        threadId: run.threadId,
        topicId: context.topicId,
      });
      run.stream.create({
        agentId: context.agentId,
        content: '',
        id: nextAssistant.id,
        parentId: run.lastChainParentId,
        role: 'assistant',
        threadId: run.threadId,
        topicId: context.topicId,
      } as UIChatMessage);
      run.currentAssistantMsgId = nextAssistant.id;
      run.currentSubagentMessageId = subagentCtx.subagentMessageId;
      run.lastChainParentId = nextAssistant.id;
      run.state = { payloads: [], persistedIds: new Set() };
      run.lastBatchToolMsgIds = [];
      run.accumulatedContent = '';
      run.accumulatedReasoning = '';
    } catch (err) {
      console.error('[HeterogeneousAgent] Failed to create subagent turn assistant:', err);
      return undefined;
    }
  }

  return run;
};

/**
 * Handle a subagent `tools_calling` chunk: ensure Thread + current
 * subagent assistant exist, then run the shared 3-phase persist
 * targeting the in-thread assistant. Accumulated text/reasoning rides
 * along in the update so DB sees content + tools in one write.
 */
const persistSubagentToolChunk = async (
  tools: ToolCallPayload[],
  subagentCtx: SubagentEventContext,
  mainAssistantMessageId: string,
  context: ConversationContext,
  subagentRuns: Map<string, SubagentRunState>,
  toolMsgIdByCallId: Map<string, string>,
  beginSubagentRun: (threadId: string) => {
    stream: SubagentStoreDispatcher;
    subOperationId: string;
  },
  onThreadCreated?: (threadId: string) => void,
) => {
  const run = await ensureSubagentRun(
    subagentCtx,
    mainAssistantMessageId,
    context,
    subagentRuns,
    beginSubagentRun,
    onThreadCreated,
  );
  if (!run) return;

  // Record every incoming tool_use id in the run-lifetime lookup set
  // before persisting, so a `tool_result` that arrives after this turn
  // has rolled over still finds its owning run via
  // `findRunByInnerToolCallId` (which can't rely on `state.persistedIds`
  // alone — that one is wiped on turn advance).
  for (const tool of tools) run.lifetimeToolCallIds.add(tool.id);

  // Snapshot the tool id set BEFORE the batch so we can compute which
  // ids this call added (for chain-parent advancement below).
  const preBatchIds = new Set(toolMsgIdByCallId.keys());

  await persistToolBatch(
    tools,
    run.state,
    run.currentAssistantMsgId,
    context,
    { content: run.accumulatedContent, reasoning: run.accumulatedReasoning },
    toolMsgIdByCallId,
    run.threadId,
    ({ assistantMessageId, toolMessageId, tool }) => {
      // Seed the tool row in the thread bucket right after its DB row
      // exists, so the tool bubble renders while the result is still
      // streaming in (matches the main-agent UX where tools[] +
      // eventual fetchAndReplace bring the row in).
      run.stream.create({
        agentId: context.agentId,
        content: '',
        id: toolMessageId,
        parentId: assistantMessageId,
        plugin: {
          apiName: tool.apiName,
          arguments: tool.arguments,
          identifier: tool.identifier,
          type: tool.type as ChatToolPayload['type'],
        },
        role: 'tool',
        threadId: run.threadId,
        tool_call_id: tool.id,
        topicId: context.topicId,
      } as UIChatMessage);
    },
  );

  // Surface the latest tools[] (with backfilled `result_msg_id`) and any
  // accumulated text / reasoning on the in-thread assistant so the
  // subagent bubble streams in step with the DB writes.
  const assistantUpdate: Partial<UIChatMessage> = { tools: [...run.state.payloads] };
  if (run.accumulatedContent) (assistantUpdate as any).content = run.accumulatedContent;
  if (run.accumulatedReasoning)
    (assistantUpdate as any).reasoning = { content: run.accumulatedReasoning };
  run.stream.update(run.currentAssistantMsgId, assistantUpdate);

  // Update chain parent to the last tool message THIS batch created so
  // the NEXT turn's assistant chains off a tool (same shape as main).
  const newIds = [...toolMsgIdByCallId.entries()]
    .filter(([id]) => !preBatchIds.has(id))
    .map(([, msgId]) => msgId);
  run.lastBatchToolMsgIds.push(...newIds);
  const lastToolMsgId = newIds.at(-1);
  if (lastToolMsgId) run.lastChainParentId = lastToolMsgId;
};

/**
 * Handle a subagent text/reasoning chunk: accumulate the content onto
 * the run state. The actual DB write happens either on the next
 * `persistToolBatch` (content rides along with tools[]) or at turn /
 * finalization flush (`ensureSubagentRun` / `finalizeSubagentRun`).
 *
 * Keeping the write batched — instead of writing on every chunk —
 * matches the main agent's content handling and avoids one DB round
 * trip per streamed token.
 */
const persistSubagentTextChunk = async (
  kind: 'text' | 'reasoning',
  chunk: string,
  subagentCtx: SubagentEventContext,
  mainAssistantMessageId: string,
  context: ConversationContext,
  subagentRuns: Map<string, SubagentRunState>,
  beginSubagentRun: (threadId: string) => {
    stream: SubagentStoreDispatcher;
    subOperationId: string;
  },
  onThreadCreated?: (threadId: string) => void,
) => {
  const run = await ensureSubagentRun(
    subagentCtx,
    mainAssistantMessageId,
    context,
    subagentRuns,
    beginSubagentRun,
    onThreadCreated,
  );
  if (!run) return;
  if (kind === 'text') {
    run.accumulatedContent += chunk;
    run.stream.update(run.currentAssistantMsgId, { content: run.accumulatedContent });
  } else {
    run.accumulatedReasoning += chunk;
    run.stream.update(run.currentAssistantMsgId, {
      reasoning: { content: run.accumulatedReasoning },
    } as Partial<UIChatMessage>);
  }
};

/**
 * Finalize a completed subagent run when the main-agent receives the
 * `tool_result` for its spawn tool_use.
 *
 * Two-step persistence:
 *
 *  1. **Flush** any streamed text/reasoning on the current in-thread
 *     assistant. CC itself never emits the subagent's final summary as
 *     a `parent_tool_use_id`-tagged assistant event (the summary only
 *     reaches us via the main-side `tool_result.content`), so this
 *     branch is usually a no-op for CC. Other adapters that stream
 *     subagent text will see their accumulated content landed here.
 *
 *  2. **Create** a terminal `role:'assistant'` message carrying the
 *     authoritative `resultContent` (what the subagent actually handed
 *     back to the main agent). The thread's shape becomes
 *     `user → asst(tools) → tool → … → asst(tools) → tool → asst(result)`,
 *     so opening the Thread view always ends with the subagent's final
 *     answer — matching the main tool_result 1:1 and exposing the
 *     summary in the thread transcript instead of hiding it inside the
 *     main tool bubble.
 *
 * `resultContent` is optional: the main tool_result path passes it, but
 * the `onComplete` fallback (called when the CLI closed without emitting
 * the spawn's tool_result) leaves it undefined so only the flush step
 * runs. Accumulators are cleared after flush so a repeat call (e.g.
 * onComplete re-running after the tool_result already finalized the
 * run) doesn't re-flush the same content.
 */
const finalizeSubagentRun = async ({
  parentToolCallId,
  context,
  subagentRuns,
  resultContent,
  completeSubOp,
}: {
  /**
   * Marks the run's sub-operation as completed once the terminal
   * persistence steps land. Closed over `get().completeOperation` in
   * the caller so this helper stays free of store coupling. Idempotent
   * — `completeOperation` no-ops on already-completed ops.
   */
  completeSubOp: (subOperationId: string) => void;
  context: ConversationContext;
  parentToolCallId: string;
  resultContent?: string;
  subagentRuns: Map<string, SubagentRunState>;
}) => {
  const run = subagentRuns.get(parentToolCallId);
  if (!run) return;

  if (run.accumulatedContent || run.accumulatedReasoning) {
    // Pin the flush target BEFORE the DB attempt — the subsequent
    // `resultContent` branch advances `currentAssistantMsgId` to the
    // terminal message, so a retry (onComplete fallback) that read
    // `currentAssistantMsgId` after the fact would overwrite the
    // authoritative terminal content with leftover streamed buffer.
    // `pendingFlushTarget` carries the correct target forward across
    // retries; clearing it is part of the success path so a fresh
    // finalize after a successful flush falls back to
    // `currentAssistantMsgId` for the next turn's content.
    const flushTarget = run.pendingFlushTarget ?? run.currentAssistantMsgId;
    const update: Record<string, any> = {};
    if (run.accumulatedContent) update.content = run.accumulatedContent;
    if (run.accumulatedReasoning) update.reasoning = { content: run.accumulatedReasoning };
    try {
      await messageService.updateMessage(flushTarget, update, {
        agentId: context.agentId,
        topicId: context.topicId,
      });
      run.stream.update(flushTarget, update);
      // Only drain the in-memory buffers after DB confirms the flush —
      // otherwise a transient updateMessage failure would swallow the
      // streamed text/reasoning, and the `onComplete` fallback couldn't
      // retry because the accumulators are already empty.
      run.accumulatedContent = '';
      run.accumulatedReasoning = '';
      run.pendingFlushTarget = undefined;
    } catch (err) {
      run.pendingFlushTarget = flushTarget;
      console.error('[HeterogeneousAgent] Failed to flush subagent streaming content:', err);
    }
  }

  if (resultContent) {
    try {
      const terminal = await messageService.createMessage({
        agentId: context.agentId,
        content: resultContent,
        parentId: run.lastChainParentId,
        role: 'assistant',
        threadId: run.threadId,
        topicId: context.topicId ?? undefined,
      });
      run.stream.create({
        agentId: context.agentId,
        content: resultContent,
        id: terminal.id,
        parentId: run.lastChainParentId,
        role: 'assistant',
        threadId: run.threadId,
        topicId: context.topicId,
      } as UIChatMessage);
      run.currentAssistantMsgId = terminal.id;
      run.lastChainParentId = terminal.id;
    } catch (err) {
      console.error('[HeterogeneousAgent] Failed to create subagent terminal assistant:', err);
    }
  }

  completeSubOp(run.subOperationId);
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
 * 1. Subscribe to IPC broadcasts
 * 2. Spawn agent process via heterogeneousAgentService
 * 3. Raw stdout lines → Adapter → HeterogeneousAgentEvent → AgentStreamEvent
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

  // Create adapter for this agent type
  const adapterType = resolveAdapterType(heterogeneousProvider);
  const adapter = createAdapter(adapterType);

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
   * Per-subagent-spawn runtime state, keyed by the main-agent Task
   * tool_use id (`SubagentEventContext.parentToolCallId`). One entry per
   * spawn, carrying the Thread id + current in-thread assistant + that
   * assistant's per-turn `ToolPersistenceState`. Lazy-created on the
   * first subagent event from `persistSubagentToolChunk`.
   *
   * Lives at executor scope (not on main `toolState`) because
   * `toolState` resets on every main-agent step boundary, whereas a
   * subagent spawn can emit events before and after a step cut.
   */
  const subagentRuns: Map<string, SubagentRunState> = new Map();
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
   * Deferred terminal event (agent_runtime_end or error). We don't forward
   * these to the gateway handler immediately because handler triggers
   * fetchAndReplaceMessages which would clobber our in-flight content
   * writes with stale DB state. onComplete forwards after persistence.
   */
  let deferredTerminalEvent: HeterogeneousAgentEvent | null = null;
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
    subagentRuns.size > 0;
  const clearStaleResumeMetadata = async () => {
    if (!context.topicId || !updateTopicMetadata) return;

    await updateTopicMetadata(context.topicId, {
      heteroSessionId: undefined,
      workingDirectory: workingDirectory ?? '',
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
   * inside `finalizeSubagentRun` once the spawn's tool_result arrives
   * on main, and again as a fallback in `onComplete` for any spawn
   * whose tool_result never landed (CLI crash, abort).
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
   * `completeOperation` so module-level helpers (`finalizeSubagentRun`)
   * stay free of store coupling. Idempotent: `completeOperation` on an
   * already-completed op is a no-op.
   */
  const completeSubagentOp = (subOperationId: string) => {
    get().completeOperation(subOperationId);
  };

  /**
   * Look up a subagent run by the tool_call_id of ANY tool inside it —
   * across ALL turns of the run, not just the current one. Uses
   * `lifetimeToolCallIds` (run-scoped, append-only) rather than
   * `state.persistedIds` (turn-scoped, wiped by `ensureSubagentRun` when
   * the subagent advances to a new `subagentMessageId`), so a delayed
   * `tool_result` arriving after the owning turn has rolled over still
   * routes to the right run and clears the in-thread tool bubble's
   * loading state.
   */
  const findRunByInnerToolCallId = (toolCallId: string): SubagentRunState | undefined => {
    for (const run of subagentRuns.values()) {
      if (run.lifetimeToolCallIds.has(toolCallId)) return run;
    }
    return undefined;
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

    // Register cancel hook on the operation — when the user hits Stop, the op
    // framework calls this; we SIGINT the CC process via the main-process IPC
    // so the CLI exits instead of running to completion off-screen.
    const sidForCancel = agentSessionId;
    get().onOperationCancel?.(operationId, () => {
      heterogeneousAgentService.cancelSession(sidForCancel).catch(() => {});
    });

    // ─── Debug tracing (dev only) ───
    const trace: Array<{ adaptedEvents: any[]; rawLine: any; timestamp: number }> = [];
    if (typeof window !== 'undefined') {
      (window as any).__HETERO_AGENT_TRACE = trace;
    }

    // Subscribe to broadcasts BEFORE sending prompt
    unsubscribe = subscribeBroadcasts(agentSessionId, {
      onRawLine: (line) => {
        // Once the user cancels, drop any trailing events the CLI emits before
        // exit so they don't leak into DB writes.
        if (isAborted()) return;
        const events = adapter.adapt(line);

        // Record for debugging
        trace.push({
          adaptedEvents: events.map((e) => ({ data: e.data, type: e.type })),
          rawLine: line,
          timestamp: Date.now(),
        });

        for (const event of events) {
          // ─── tool_result: update tool message content in DB (ACP-only) ───
          if (event.type === 'tool_result') {
            const { content, isError, pluginState, toolCallId } = event.data as {
              content: string;
              isError?: boolean;
              pluginState?: Record<string, any>;
              subagent?: SubagentEventContext;
              toolCallId: string;
            };
            // Subagent vs main lookup is transparent — one global
            // `toolMsgIdByCallId` map spans both scopes.
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
            // Mirror the tool_result content into the owning subagent
            // run's thread bucket so the in-thread tool bubble stops
            // showing "loading" and renders the result the moment it
            // arrives (main-topic fetchAndReplace does not refresh
            // thread buckets, so without this the subagent UI would
            // stay stuck on the spinner until the user re-opens the
            // Thread). Lookup is deferred into the queue because the
            // prior `persistSubagentToolChunk` that adds this toolCallId
            // to the run's `persistedIds` is still pending when the
            // tool_result event arrives.
            persistQueue = persistQueue.then(() => {
              const run = findRunByInnerToolCallId(toolCallId);
              if (!run) return;
              const toolMsgId = toolMsgIdByCallId.get(toolCallId);
              if (!toolMsgId) return;
              const update: Partial<UIChatMessage> = { content };
              if (pluginState) (update as any).pluginState = pluginState;
              if (isError) (update as any).pluginError = { message: content };
              run.stream.update(toolMsgId, update);
            });
            // If this tool_result IS for a subagent's spawning tool_use
            // (tool_result lands on the MAIN side but its toolCallId
            // matches a subagent run's parent), the subagent run just
            // ended — finalize so the terminal assistant with the
            // authoritative result lands in DB before fetchAndReplace.
            //
            // The `subagentRuns.has` check is deferred INTO the queue so
            // that any subagent tool_use/text chunks from earlier in the
            // same onRawLine batch — which register the run via
            // `persistSubagent*Chunk` — have already drained. Checking
            // synchronously here races with those writes and silently
            // misses the run in pure-tools subagents (no preceding text
            // event to force an earlier registration).
            persistQueue = persistQueue.then(() => {
              if (!subagentRuns.has(toolCallId)) return;
              return finalizeSubagentRun({
                completeSubOp: completeSubagentOp,
                context,
                parentToolCallId: toolCallId,
                resultContent: content,
                subagentRuns,
              });
            });
            // Don't forward — the tool_end that follows triggers fetchAndReplaceMessages
            // which reads the updated content from DB.
            continue;
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
            if (event.data.model) lastModel = event.data.model;
            if (event.data.provider) lastProvider = event.data.provider;
            const turnUsage = event.data.usage;
            if (turnUsage) {
              persistQueue = persistQueue.then(async () => {
                await messageService
                  .updateMessage(
                    currentAssistantMessageId,
                    { metadata: { usage: turnUsage } },
                    { agentId: context.agentId, topicId: context.topicId },
                  )
                  .catch(console.error);
              });
            }
            // Don't forward turn metadata — it's internal bookkeeping
            continue;
          }

          // ─── stream_start with newStep: new LLM turn, create new assistant message ───
          if (event.type === 'stream_start' && event.data?.newStep) {
            // ⚠️ Snapshot CONTENT accumulators synchronously — stream_chunk events for
            // the new step arrive in the same onRawLine batch and would contaminate.
            // Tool state (toolMsgIdByCallId) is populated ASYNC by persistQueue, so
            // it must be read inside the queue where previous persists have completed.
            const prevContent = accumulatedContent;
            const prevReasoning = accumulatedReasoning;
            const prevModel = lastModel;
            const prevProvider = lastProvider;

            // Reset content accumulators synchronously so new-step chunks go to fresh state
            accumulatedContent = '';
            accumulatedReasoning = '';

            // Mark that we're in a step transition. Events from the same onRawLine
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
              const stepParentId = lastToolMsgId || currentAssistantMessageId;

              const newMsg = await messageService.createMessage({
                agentId: context.agentId,
                content: '',
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
              eventHandler(toStreamEvent(event, operationId));
              // Step transition complete — handler has the new assistant ID now
              pendingStepTransition = false;
            });
            continue;
          }

          // ─── Defer terminal events so content writes complete first ───
          // Gateway handler's agent_runtime_end/error triggers fetchAndReplaceMessages,
          // which would read stale DB state (before we persist final content + usage).
          if (event.type === 'agent_runtime_end' || event.type === 'error') {
            deferredTerminalEvent = event;
            continue;
          }

          // ─── stream_chunk: accumulate content + persist tool_use ───
          if (event.type === 'stream_chunk') {
            const chunk = event.data;
            const chunkSubagentCtx = chunk?.subagent as SubagentEventContext | undefined;
            if (chunk?.chunkType === 'text' && chunk.content) {
              if (chunkSubagentCtx) {
                // Subagent text → accumulates on the run's in-thread
                // assistant, NOT on the main assistant's content.
                const mainAsstId = currentAssistantMessageId;
                persistQueue = persistQueue.then(() =>
                  persistSubagentTextChunk(
                    'text',
                    chunk.content,
                    chunkSubagentCtx,
                    mainAsstId,
                    context,
                    subagentRuns,
                    beginSubagentRun,
                    onSubagentThreadCreated,
                  ),
                );
              } else {
                accumulatedContent += chunk.content;
              }
            }
            if (chunk?.chunkType === 'reasoning' && chunk.reasoning) {
              if (chunkSubagentCtx) {
                const mainAsstId = currentAssistantMessageId;
                persistQueue = persistQueue.then(() =>
                  persistSubagentTextChunk(
                    'reasoning',
                    chunk.reasoning,
                    chunkSubagentCtx,
                    mainAsstId,
                    context,
                    subagentRuns,
                    beginSubagentRun,
                    onSubagentThreadCreated,
                  ),
                );
              } else {
                accumulatedReasoning += chunk.reasoning;
              }
            }
            if (chunk?.chunkType === 'tools_calling') {
              const tools = chunk.toolsCalling as ToolCallPayload[];
              const subagentCtx = chunk.subagent as SubagentEventContext | undefined;
              if (tools?.length) {
                if (subagentCtx) {
                  // Subagent chunk → lazy-create Thread + in-thread
                  // assistant, then persist into that scope. Kept off the
                  // main path so main-agent snapshot logic stays untouched.
                  const mainAsstId = currentAssistantMessageId;
                  persistQueue = persistQueue.then(() =>
                    persistSubagentToolChunk(
                      tools,
                      subagentCtx,
                      mainAsstId,
                      context,
                      subagentRuns,
                      toolMsgIdByCallId,
                      beginSubagentRun,
                      onSubagentThreadCreated,
                    ),
                  );
                } else {
                  // Main-agent chunk — existing path.
                  // Snapshot accumulators sync — must travel with the
                  // same step's assistantMessageId. A late-bound getter
                  // would read NEW step's content if a step transition
                  // lands between scheduling and execution, while
                  // assistantMessageId would still be the OLD one (also
                  // captured sync) → cross-step contamination.
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

          // Subagent-tagged stream_chunks are persisted above via
          // persistSubagent*Chunk into the in-thread assistant. The gateway
          // handler is main-agent-only: forwarding would dispatch
          // `updateMessage { tools }` onto `currentAssistantMessageId` (main),
          // overwriting main.tools[] with subagent tools — main's own
          // tool_use messages then lose their tools[] pairing and render
          // as orphans until the next fetchAndReplaceMessages. Text /
          // reasoning chunks similarly bleed subagent content into the
          // main bubble. DB state is already correct (the subagent persist
          // path writes to the thread scope), so dropping the forward
          // keeps in-memory state aligned with DB.
          if (event.type === 'stream_chunk' && (event.data as any)?.subagent) {
            continue;
          }

          // Forward to the unified Gateway handler.
          // If a step transition is pending, defer through persistQueue so the
          // handler receives stream_start (with new assistant ID) FIRST.
          if (pendingStepTransition) {
            const snapshot = toStreamEvent(event, operationId);
            persistQueue = persistQueue.then(() => {
              eventHandler(snapshot);
            });
          } else {
            eventHandler(toStreamEvent(event, operationId));
          }
        }
      },

      onComplete: async () => {
        if (completed) return;
        completed = true;

        // Flush remaining adapter state (e.g., still-open tool_end events — but
        // NOT agent_runtime_end; that's deferred below)
        const flushEvents = adapter.flush();
        for (const event of flushEvents) {
          if (event.type === 'agent_runtime_end' || event.type === 'error') {
            deferredTerminalEvent = event;
            continue;
          }
          eventHandler(toStreamEvent(event, operationId));
        }

        // Wait for all tool persistence to finish before writing final state
        await persistQueue.catch(console.error);

        // Flush any subagent runs that didn't see their parent's
        // tool_result (e.g. CLI crashed mid-subagent, or CC emitted the
        // spawn's tool_result after the stream closed). Ensures the
        // in-thread assistant has its final text before fetchAndReplace.
        for (const parentId of subagentRuns.keys()) {
          await finalizeSubagentRun({
            completeSubOp: completeSubagentOp,
            context,
            parentToolCallId: parentId,
            subagentRuns,
          }).catch(console.error);
        }

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
          // NOW forward the deferred terminal event — handler will fetchAndReplaceMessages
          // and pick up the final persisted state.
          const terminal = deferredTerminalEvent ?? {
            data: {},
            stepIndex: 0,
            timestamp: Date.now(),
            type: 'agent_runtime_end' as const,
          };
          eventHandler(toStreamEvent(terminal, operationId));
        }

        // Signal completion to the user — dock badge + (window-hidden) notification.
        // Skip for aborted runs and for error terminations.
        if (!isAborted() && deferredTerminalEvent?.type !== 'error') {
          const body = accumulatedContent
            ? markdownToTxt(accumulatedContent)
            : t('notification.finishChatGeneration', { ns: 'electron' });
          notifyCompletion(t('notification.finishChatGeneration', { ns: 'electron' }), body);
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
        if (isAborted()) return;

        await persistTerminalError(messageError, { clearContent: shouldClearTerminalErrorContent });
      },
    });

    // Send the prompt — blocks until process exits
    await heterogeneousAgentService.sendPrompt(agentSessionId, message, imageList);

    // Persist heterogeneous-agent session id + the cwd it was created under,
    // for multi-turn resume. CC stores sessions per-cwd
    // (`~/.claude/projects/<encoded-cwd>/`), so the next turn must verify the
    // cwd hasn't changed before `--resume`. Reuses `workingDirectory` as the
    // topic-level binding — pinning the topic to this cwd once the agent has
    // executed here.
    if (adapter.sessionId && context.topicId) {
      await updateTopicMetadata?.(context.topicId, {
        heteroSessionId: adapter.sessionId,
        workingDirectory: workingDirectory ?? '',
      });
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
      if (isAborted()) return;
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
