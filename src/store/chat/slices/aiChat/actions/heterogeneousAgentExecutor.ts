import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { isDesktop } from '@lobechat/const';
import type {
  HeterogeneousAgentEvent,
  SubagentEventContext,
  ToolCallPayload,
} from '@lobechat/heterogeneous-agents';
import { createAdapter } from '@lobechat/heterogeneous-agents';
import type {
  ChatToolPayload,
  ConversationContext,
  HeterogeneousProviderConfig,
} from '@lobechat/types';
import { ThreadStatus, ThreadType } from '@lobechat/types';
import { createNanoId } from '@lobechat/utils';
import { t } from 'i18next';

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
    onError: (error: string) => void;
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
  const onError = (_e: any, data: { error: string; sessionId: string }) => {
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
   * Per-subagent-assistant persistence state (tools[] payloads +
   * dedupe). Reset on every turn boundary so each in-thread assistant
   * has its own tools[].
   */
  state: ToolPersistenceState;
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

    run = {
      accumulatedContent: '',
      accumulatedReasoning: '',
      currentAssistantMsgId: firstAssistantId,
      currentSubagentMessageId: subagentCtx.subagentMessageId ?? '',
      lastBatchToolMsgIds: [],
      lastChainParentId: firstAssistantId,
      state: { payloads: [], persistedIds: new Set() },
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
  onThreadCreated?: (threadId: string) => void,
) => {
  const run = await ensureSubagentRun(
    subagentCtx,
    mainAssistantMessageId,
    context,
    subagentRuns,
    onThreadCreated,
  );
  if (!run) return;

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
  );

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
  onThreadCreated?: (threadId: string) => void,
) => {
  const run = await ensureSubagentRun(
    subagentCtx,
    mainAssistantMessageId,
    context,
    subagentRuns,
    onThreadCreated,
  );
  if (!run) return;
  if (kind === 'text') run.accumulatedContent += chunk;
  else run.accumulatedReasoning += chunk;
};

/**
 * Flush any pending content/reasoning on the in-thread assistant for a
 * completed subagent run. Called when the main-agent receives the
 * `tool_result` for the subagent's spawn tool_use (the run's
 * `parentToolCallId`) — at that point the subagent is done and its
 * last turn's summary text needs to land in DB before the UI refreshes.
 *
 * Pure DB write; does not mutate `subagentRuns` (we don't delete the
 * entry so late/out-of-order chunks still have a target if they arrive).
 */
const finalizeSubagentRun = async (
  parentToolCallId: string,
  context: ConversationContext,
  subagentRuns: Map<string, SubagentRunState>,
) => {
  const run = subagentRuns.get(parentToolCallId);
  if (!run) return;
  if (!run.accumulatedContent && !run.accumulatedReasoning) return;
  const update: Record<string, any> = {};
  if (run.accumulatedContent) update.content = run.accumulatedContent;
  if (run.accumulatedReasoning) update.reasoning = { content: run.accumulatedReasoning };
  try {
    await messageService.updateMessage(run.currentAssistantMsgId, update, {
      agentId: context.agentId,
      topicId: context.topicId,
    });
  } catch (err) {
    console.error('[HeterogeneousAgent] Failed to finalize subagent run:', err);
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

  let agentSessionId: string | undefined;
  let unsubscribe: (() => void) | undefined;
  let completed = false;

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

  try {
    // Start session (pass resumeSessionId for multi-turn --resume)
    const result = await heterogeneousAgentService.startSession({
      agentType: adapterType,
      args: heterogeneousProvider.args,
      command: heterogeneousProvider.command || 'claude',
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
            // If this tool_result IS for a subagent's spawning tool_use
            // (tool_result lands on the MAIN side but its toolCallId
            // matches a subagent run's parent), the subagent run just
            // ended — flush any pending in-thread assistant content so
            // the final summary lands in DB before fetchAndReplace.
            if (subagentRuns.has(toolCallId)) {
              persistQueue = persistQueue.then(() =>
                finalizeSubagentRun(toolCallId, context, subagentRuns),
              );
            }
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
          await finalizeSubagentRun(parentId, context, subagentRuns).catch(console.error);
        }

        // Persist final content + reasoning + model for the last step BEFORE the
        // terminal event triggers fetchAndReplaceMessages. Usage for this step
        // was already written per-turn via the turn_metadata branch.
        const updateValue: Record<string, any> = {};
        if (accumulatedContent) updateValue.content = accumulatedContent;
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

        // NOW forward the deferred terminal event — handler will fetchAndReplaceMessages
        // and pick up the final persisted state.
        const terminal = deferredTerminalEvent ?? {
          data: {},
          stepIndex: 0,
          timestamp: Date.now(),
          type: 'agent_runtime_end' as const,
        };
        eventHandler(toStreamEvent(terminal, operationId));

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
        completed = true;

        await persistQueue.catch(console.error);

        if (accumulatedContent) {
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

        eventHandler(
          toStreamEvent(
            {
              data: { error, message: error },
              stepIndex: 0,
              timestamp: Date.now(),
              type: 'error',
            },
            operationId,
          ),
        );
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
      get().updateTopicMetadata(context.topicId, {
        heteroSessionId: adapter.sessionId,
        workingDirectory: workingDirectory ?? '',
      });
    }
  } catch (error) {
    if (!completed) {
      completed = true;
      // `sendPrompt` rejects when the CLI exits non-zero, which is how SIGINT
      // lands here too. If the user cancelled, don't surface an error.
      if (isAborted()) return;
      const errorMsg = error instanceof Error ? error.message : 'Agent execution failed';
      eventHandler(
        toStreamEvent(
          {
            data: { error: errorMsg, message: errorMsg },
            stepIndex: 0,
            timestamp: Date.now(),
            type: 'error',
          },
          operationId,
        ),
      );
    }
  } finally {
    unsubscribe?.();
    // Don't stopSession here — keep it alive for multi-turn resume.
    // Session cleanup happens on topic deletion or Electron quit.
  }
};
